package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.workplace.mail.dto.MailMoveRequest;
import com.workplace.mail.dto.MailMoveRequest.Kind;
import com.workplace.mail.dto.MailMoveResponse;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphBatchRequest;
import com.workplace.mail.outbound.GraphBatchResponse;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.service.GraphBodyLoader;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.folder.MailFolderService;
import com.workplace.mail.service.graph.GraphDeltaPage;
import com.workplace.mail.service.graph.GraphMessage;
import com.workplace.mail.service.graph.GraphMessage.EmailAddress;
import com.workplace.mail.service.graph.GraphMessage.Recipient;
import com.workplace.mail.service.move.MailMoveService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * 메일 옮기기(WP-962) Graph 통합 테스트 — {@link GraphApiClient}·{@link GraphTokenService} 를 스텁하고 $batch 로
 * 보내는 요청(URL· 본문·순서)과, 옮긴 메일의 새 id 를 같은 행에 반영하는지, 다음 동기화가 중복으로 넣지 않는지, 부분 실패·읽음 반영 실패·batch 전체 실패를
 * 본다.
 */
@Transactional
class MailMoveGraphTest extends ExternalClientMockedTestBase {

  private static final String TOKEN = "FAKE_TOKEN";
  private static final ObjectMapper JSON = JsonMapper.builderWithJackson2Defaults().build();

  @Autowired DSLContext dsl;
  @Autowired MailMoveService moveService;
  @Autowired MailFolderService folderService;
  @Autowired EmailFolderRepository folderRepo;

  @Autowired GraphApiClient graphApiClient;
  @Autowired GraphTokenService graphTokenService;

  /** 보낸 batch 요청 묶음(호출 순서대로). */
  private final List<List<GraphBatchRequest>> batches = new ArrayList<>();

  /** [user, account, inboxFolderId, archiveFolderId] */
  private long[] setup() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long archive =
        folderRepo
            .upsertServerFolder(
                accountId, "id-arch", "id-arch", "Archive", "ARCHIVE", true, 4, 9, null)
            .orElseThrow();
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn(TOKEN);
    return new long[] {user, accountId, inbox, archive};
  }

  private long seed(
      long accountId, long folderId, String providerId, boolean seen, boolean pending) {
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID, providerId)
        .set(EMAIL_MESSAGE.THREAD_ID, "thread-" + providerId)
        .set(EMAIL_MESSAGE.SEEN, seen)
        .set(EMAIL_MESSAGE.SEEN_PUSH_PENDING, pending)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /** batch 스텁 — 요청마다 응답을 정한다. 요청 묶음은 {@link #batches} 에 쌓는다. */
  private void stubBatch(Function<GraphBatchRequest, GraphBatchResponse> reply) {
    when(graphApiClient.batch(eq(TOKEN), any()))
        .thenAnswer(
            inv -> {
              List<GraphBatchRequest> reqs = inv.getArgument(1);
              batches.add(reqs);
              return reqs.stream().map(reply).toList();
            });
  }

  /** 옮기기는 201 + 새 id(옛 id 앞에 NEW-), 읽음 PATCH 는 200. */
  private static GraphBatchResponse okReply(GraphBatchRequest r) {
    if ("POST".equals(r.method())) {
      String old = r.url().replace("/me/messages/", "").replace("/move", "");
      return new GraphBatchResponse(r.id(), 201, JSON.createObjectNode().put("id", "NEW-" + old));
    }
    return new GraphBatchResponse(r.id(), 200);
  }

  private static MailMoveRequest req(Kind kind, Long folderId, long... ids) {
    List<Long> list = new ArrayList<>();
    for (long id : ids) {
      list.add(id);
    }
    return new MailMoveRequest(list, new MailMoveRequest.Target(kind, folderId));
  }

  @Test
  void archive_patchesPendingSeenFirst_thenMoves_andKeepsRowWithNewId() {
    long[] s = setup();
    long id = seed(s[1], s[2], "G1", true, true); // 로컬에서 읽고 아직 서버 반영 전
    stubBatch(MailMoveGraphTest::okReply);

    MailMoveResponse r = moveService.move(s[0], s[1], req(Kind.ARCHIVE, null, id));

    assertThat(r.results()).singleElement().satisfies(x -> assertThat(x.ok()).isTrue());
    // 1) 옛 id 로 읽음 반영 → 2) 옮기기(보관 폴더 id)
    assertThat(batches).hasSize(2);
    assertThat(batches.get(0))
        .singleElement()
        .satisfies(
            q -> {
              assertThat(q.method()).isEqualTo("PATCH");
              assertThat(q.url()).isEqualTo("/me/messages/G1");
              assertThat(q.body()).isEqualTo(Map.of("isRead", true));
            });
    assertThat(batches.get(1))
        .singleElement()
        .satisfies(
            q -> {
              assertThat(q.method()).isEqualTo("POST");
              assertThat(q.url()).isEqualTo("/me/messages/G1/move");
              assertThat(q.body()).isEqualTo(Map.of("destinationId", "id-arch"));
            });
    Record row = row(id);
    assertThat(row.get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(s[3]);
    assertThat(row.get(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID)).isEqualTo("NEW-G1");
    assertThat(row.get(EMAIL_MESSAGE.SEEN_PUSH_PENDING)).isFalse();
    assertThat(serverUnread(s[3])).isEqualTo(4); // 읽은 메일 — 보관 안 읽은 수 그대로

    // 다음 보관 메일함 동기화가 같은 메일(새 id)을 다시 넣지 않는다
    when(graphApiClient.get(eq(TOKEN), anyString(), eq(GraphDeltaPage.class)))
        .thenReturn(new GraphDeltaPage(List.of(message("NEW-G1")), null, "DL"));
    assertThat(folderService.syncFolder(s[0], s[1], s[3], false).saved()).isZero();
    assertThat(dsl.fetchCount(EMAIL_MESSAGE, EMAIL_MESSAGE.ACCOUNT_ID.eq(s[1]))).isEqualTo(1);
  }

  @Test
  void movedMailWithAttachments_getsNewAttachmentIds_soDownloadsKeepWorking() {
    long[] s = setup();
    long id = seed(s[1], s[2], "G1", true, false);
    for (int i = 0; i < 2; i++) {
      dsl.insertInto(EMAIL_ATTACHMENT)
          .set(EMAIL_ATTACHMENT.MESSAGE_ID, id)
          .set(EMAIL_ATTACHMENT.ORDINAL, i)
          .set(EMAIL_ATTACHMENT.PROVIDER_ATTACHMENT_ID, "OLD-ATT-" + i)
          .execute();
    }
    stubBatch(MailMoveGraphTest::okReply);
    // 옮긴 뒤 새 메시지 id 아래 첨부 목록(같은 순서, 새 id)
    when(graphApiClient.get(
            eq(TOKEN),
            eq("/me/messages/NEW-G1/attachments?$select=id"),
            eq(GraphBodyLoader.GraphAttachmentList.class)))
        .thenReturn(
            new GraphBodyLoader.GraphAttachmentList(
                List.of(
                    new GraphBodyLoader.GraphAttachmentItem("NEW-ATT-0", null, null, null, null),
                    new GraphBodyLoader.GraphAttachmentItem("NEW-ATT-1", null, null, null, null))));

    assertThat(moveService.move(s[0], s[1], req(Kind.ARCHIVE, null, id)).results().get(0).ok())
        .isTrue();

    assertThat(
            dsl.select(EMAIL_ATTACHMENT.PROVIDER_ATTACHMENT_ID)
                .from(EMAIL_ATTACHMENT)
                .where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(id))
                .orderBy(EMAIL_ATTACHMENT.ORDINAL)
                .fetch(EMAIL_ATTACHMENT.PROVIDER_ATTACHMENT_ID))
        .containsExactly("NEW-ATT-0", "NEW-ATT-1");
  }

  @Test
  void inboxAndTrash_useWellKnownNames_trashDeletesLocally_unreadCountsAdjusted() {
    long[] s = setup();
    long archived = seed(s[1], s[3], "A1", false, false);
    long toTrash = seed(s[1], s[2], "T1", false, false);
    stubBatch(MailMoveGraphTest::okReply);

    assertThat(moveService.move(s[0], s[1], req(Kind.INBOX, null, archived)).results().get(0).ok())
        .isTrue();
    assertThat(batches.get(0).get(0).body()).isEqualTo(Map.of("destinationId", "inbox"));
    assertThat(row(archived).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(s[2]);
    assertThat(serverUnread(s[3])).isEqualTo(3); // 안 읽은 메일이 보관에서 빠졌다

    assertThat(moveService.move(s[0], s[1], req(Kind.TRASH, null, toTrash)).results().get(0).ok())
        .isTrue();
    assertThat(batches.get(1).get(0).url()).isEqualTo("/me/messages/T1/move");
    assertThat(batches.get(1).get(0).body()).isEqualTo(Map.of("destinationId", "deleteditems"));
    assertThat(dsl.fetchExists(EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(toTrash))).isFalse();
  }

  @Test
  void trash_keepsRow_andRestoreMovesBack() {
    long[] s = setup();
    long trash =
        folderRepo
            .upsertServerFolder(
                s[1], "id-trash", "id-trash", "Deleted Items", "TRASH", true, null, null, null)
            .orElseThrow();
    long archived = seed(s[1], s[3], "A1", true, false);
    long inboxed = seed(s[1], s[2], "I1", true, false);
    stubBatch(MailMoveGraphTest::okReply);

    // 삭제: 서버 휴지통(well-known)으로 옮기고 같은 행을 휴지통 행으로, 원래 메일함을 기억한다
    MailMoveResponse r = moveService.move(s[0], s[1], req(Kind.TRASH, null, archived, inboxed));
    assertThat(r.results()).allSatisfy(x -> assertThat(x.ok()).isTrue());
    assertThat(batches.get(0))
        .allSatisfy(q -> assertThat(q.body()).isEqualTo(Map.of("destinationId", "deleteditems")));
    assertThat(row(archived).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(trash);
    assertThat(row(archived).get(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID)).isEqualTo("NEW-A1");
    assertThat(row(archived).get(EMAIL_MESSAGE.ORIGINAL_FOLDER_ID)).isEqualTo(s[3]);
    assertThat(row(inboxed).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(trash);
    assertThat(row(inboxed).get(EMAIL_MESSAGE.ORIGINAL_FOLDER_ID)).isEqualTo(s[2]);

    // 되살리기: 메일마다 원래 메일함으로 — 보관은 그 폴더 id, 받은편지함은 well-known inbox
    MailMoveResponse back =
        moveService.move(s[0], s[1], req(Kind.RESTORE, null, archived, inboxed));
    assertThat(back.results())
        .extracting(MailMoveResponse.Result::messageId, MailMoveResponse.Result::ok)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple(archived, true),
            org.assertj.core.groups.Tuple.tuple(inboxed, true));
    List<Object> restoreBodies = new ArrayList<>();
    batches.subList(1, batches.size()).forEach(b -> b.forEach(q -> restoreBodies.add(q.body())));
    assertThat(restoreBodies)
        .containsExactlyInAnyOrder(
            Map.of("destinationId", "id-arch"), Map.of("destinationId", "inbox"));
    assertThat(row(archived).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(s[3]);
    assertThat(row(archived).get(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID)).isEqualTo("NEW-NEW-A1");
    assertThat(row(archived).get(EMAIL_MESSAGE.ORIGINAL_FOLDER_ID)).isNull();
    assertThat(row(inboxed).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(s[2]);
    assertThat(row(inboxed).get(EMAIL_MESSAGE.ORIGINAL_FOLDER_ID)).isNull();
  }

  /**
   * WP-1681: 되살리기는 목적지별 묶음을 차례로 옮긴다. 앞 묶음이 이미 서버·로컬에 반영된 뒤 다음 묶음이 서버 접속에 실패하면 요청 전체를 502 로 돌리면 안
   * 된다(앞 묶음은 이미 옮겼다) — 실패한 묶음의 메일만 ok=false 로 담고 200 으로 돌려준다.
   */
  @Test
  void restore_laterGroupFails_keepsEarlierGroupAndReportsFailedMails() {
    long[] s = setup();
    long trash = trashRow(s[1]);
    long archived = seedInTrash(s[1], trash, "A1", s[3]);
    long inboxed = seedInTrash(s[1], trash, "I1", s[2]);
    stubBatch(MailMoveGraphTest::okReply);
    // 첫 묶음(보관)은 연결되고, 둘째 묶음(받은편지함)은 서버 접속부터 실패한다
    when(graphTokenService.getAccessToken(anyLong(), anyLong()))
        .thenReturn(TOKEN)
        .thenThrow(new MailSyncException("메일 서버에 연결하지 못했습니다"));

    MailMoveResponse r = moveService.move(s[0], s[1], req(Kind.RESTORE, null, archived, inboxed));

    assertThat(r.results())
        .extracting(
            MailMoveResponse.Result::messageId,
            MailMoveResponse.Result::ok,
            MailMoveResponse.Result::error)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple(archived, true, null),
            org.assertj.core.groups.Tuple.tuple(inboxed, false, "메일 서버에 연결하지 못했습니다"));
    assertThat(row(archived).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(s[3]);
    assertThat(row(archived).get(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID)).isEqualTo("NEW-A1");
    // 실패한 메일은 휴지통에 그대로(원래 메일함 기록도 그대로)
    assertThat(row(inboxed).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(trash);
    assertThat(row(inboxed).get(EMAIL_MESSAGE.ORIGINAL_FOLDER_ID)).isEqualTo(s[2]);
  }

  /** WP-1681: 되살리기 첫 묶음부터 서버 접속에 실패하면 아무것도 옮기지 않았으니 지금처럼 502(MailSyncException)다. */
  @Test
  void restore_firstGroupFails_is502() {
    long[] s = setup();
    long trash = trashRow(s[1]);
    long archived = seedInTrash(s[1], trash, "A1", s[3]);
    long inboxed = seedInTrash(s[1], trash, "I1", s[2]);
    when(graphTokenService.getAccessToken(anyLong(), anyLong()))
        .thenThrow(new MailSyncException("메일 서버에 연결하지 못했습니다"));

    assertThatThrownBy(
            () -> moveService.move(s[0], s[1], req(Kind.RESTORE, null, archived, inboxed)))
        .isInstanceOf(MailSyncException.class);
    assertThat(row(archived).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(trash);
    assertThat(row(inboxed).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(trash);
  }

  /** 계정에 휴지통 행(role TRASH)을 넣는다(WP-1681). */
  private long trashRow(long accountId) {
    return folderRepo
        .upsertServerFolder(
            accountId, "id-trash", "id-trash", "Deleted Items", "TRASH", true, null, null, null)
        .orElseThrow();
  }

  /** 휴지통에 원래 메일함을 기억한 메일을 넣는다(앱에서 지운 메일처럼, WP-1681). */
  private long seedInTrash(long accountId, long trash, String providerId, long original) {
    long id = seed(accountId, trash, providerId, true, false);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ORIGINAL_FOLDER_ID, original)
        .where(EMAIL_MESSAGE.ID.eq(id))
        .execute();
    return id;
  }

  @Test
  void partialFailure_keepsFailedRow() {
    long[] s = setup();
    long ok = seed(s[1], s[2], "OK1", true, false);
    long gone = seed(s[1], s[2], "GONE", true, false);
    stubBatch(r -> r.url().contains("GONE") ? new GraphBatchResponse(r.id(), 404) : okReply(r));

    MailMoveResponse res = moveService.move(s[0], s[1], req(Kind.ARCHIVE, null, ok, gone));

    assertThat(res.results().get(0).ok()).isTrue();
    assertThat(res.results().get(1).ok()).isFalse();
    assertThat(res.results().get(1).error()).contains("찾을 수 없습니다");
    assertThat(row(ok).get(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID)).isEqualTo("NEW-OK1");
    assertThat(row(gone).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(s[2]);
    assertThat(row(gone).get(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID)).isEqualTo("GONE");
  }

  @Test
  void seenPatchFails_stillMoves_andLeavesPendingForRetryWithNewId() {
    long[] s = setup();
    long id = seed(s[1], s[2], "P1", true, true);
    stubBatch(r -> "PATCH".equals(r.method()) ? new GraphBatchResponse(r.id(), 503) : okReply(r));

    assertThat(moveService.move(s[0], s[1], req(Kind.ARCHIVE, null, id)).results().get(0).ok())
        .isTrue();
    assertThat(row(id).get(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID)).isEqualTo("NEW-P1");
    assertThat(row(id).get(EMAIL_MESSAGE.SEEN_PUSH_PENDING)).isTrue(); // 재시도 배치가 새 id 로 반영
  }

  @Test
  void batchFailure_failsAll_andChangesNothing() {
    long[] s = setup();
    long id = seed(s[1], s[2], "X1", false, false);
    when(graphApiClient.batch(eq(TOKEN), any())).thenThrow(new MailSendException("batch 실패"));

    MailMoveResponse res = moveService.move(s[0], s[1], req(Kind.ARCHIVE, null, id));

    assertThat(res.results().get(0).ok()).isFalse();
    assertThat(row(id).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(s[2]);
    assertThat(serverUnread(s[3])).isEqualTo(4);
  }

  private Record row(long id) {
    return dsl.selectFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ID.eq(id)).fetchSingle();
  }

  private Integer serverUnread(long folderId) {
    return dsl.select(EMAIL_FOLDER.SERVER_UNREAD)
        .from(EMAIL_FOLDER)
        .where(EMAIL_FOLDER.ID.eq(folderId))
        .fetchSingle(EMAIL_FOLDER.SERVER_UNREAD);
  }

  /**
   * WP-1741: 별표를 바꾸고 바로 보관하면 반영 대기 별표를 옛 id 로 옮기기 전에 먼저 PATCH 한다(읽음도 대기면 한 본문에 함께). 보내지 않고 옮기면 나중
   * 역동기화가 옛 id 에서 404 를 성공으로 보고 대기를 풀고, 보관함 동기화가 서버 flag(별표 없음)로 별표를 지운다. 켜기·끄기 둘 다 본다.
   */
  @Test
  void archive_patchesPendingFlagFirst_starSurvivesDestinationSync() {
    long[] s = setup();
    long on = seed(s[1], s[2], "G1", true, false); // 읽음 대기 없음 — 별표만 켜는 중
    long off = seed(s[1], s[2], "G2", true, true); // 읽음 대기 + 별표 끄는 중
    setFlag(on, true);
    setFlag(off, false);
    stubBatch(MailMoveGraphTest::okReply);

    MailMoveResponse r = moveService.move(s[0], s[1], req(Kind.ARCHIVE, null, on, off));

    assertThat(r.results()).allSatisfy(x -> assertThat(x.ok()).isTrue());
    // 1) 옛 id 로 대기 속성만 PATCH → 2) 옮기기
    assertThat(batches).hasSize(2);
    assertThat(batches.get(0))
        .extracting(GraphBatchRequest::method, GraphBatchRequest::url, GraphBatchRequest::body)
        .containsExactlyInAnyOrder(
            org.assertj.core.groups.Tuple.tuple(
                "PATCH", "/me/messages/G1", Map.of("flag", Map.of("flagStatus", "flagged"))),
            org.assertj.core.groups.Tuple.tuple(
                "PATCH",
                "/me/messages/G2",
                Map.of("isRead", true, "flag", Map.of("flagStatus", "notFlagged"))));
    assertThat(batches.get(1)).allSatisfy(q -> assertThat(q.method()).isEqualTo("POST"));
    // 보낸 별표 대기는 풀렸다
    assertThat(row(on).get(EMAIL_MESSAGE.FLAGGED_PUSH_PENDING)).isFalse();
    assertThat(row(off).get(EMAIL_MESSAGE.FLAGGED_PUSH_PENDING)).isFalse();
    assertThat(row(off).get(EMAIL_MESSAGE.SEEN_PUSH_PENDING)).isFalse();

    // 보관함 동기화: 서버 flag 가 이미 맞춰져 있어 별표가 그대로다
    when(graphApiClient.get(eq(TOKEN), anyString(), eq(GraphDeltaPage.class)))
        .thenReturn(
            new GraphDeltaPage(
                List.of(
                    flaggedMessage("NEW-G1", "flagged"), flaggedMessage("NEW-G2", "notFlagged")),
                null,
                "DL"));
    folderService.syncFolder(s[0], s[1], s[3], false);
    assertThat(row(on).get(EMAIL_MESSAGE.FLAGGED)).isTrue();
    assertThat(row(off).get(EMAIL_MESSAGE.FLAGGED)).isFalse();
  }

  /** 로컬 별표를 바꾸고 서버 반영 대기로 둔다(WP-1741 — 사용자가 별표를 바꾼 직후). */
  private void setFlag(long id, boolean flagged) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.FLAGGED, flagged)
        .set(EMAIL_MESSAGE.FLAGGED_PUSH_PENDING, true)
        .where(EMAIL_MESSAGE.ID.eq(id))
        .execute();
  }

  /** flagStatus 를 지정한 delta 항목(WP-1741). */
  private static GraphMessage flaggedMessage(String id, String flagStatus) {
    return new GraphMessage(
        id,
        "제목 " + id,
        new Recipient(new EmailAddress("sender@example.com", "보낸사람")),
        List.of(new Recipient(new EmailAddress("to@example.com", "받는사람"))),
        List.of(),
        "2026-10-01T10:00:00Z",
        "2026-10-01T09:55:00Z",
        true,
        false,
        "<msg-" + id + "@example.com>",
        "conv-" + id,
        null,
        new GraphMessage.Flag(flagStatus));
  }

  private static GraphMessage message(String id) {
    return new GraphMessage(
        id,
        "제목 " + id,
        new Recipient(new EmailAddress("sender@example.com", "보낸사람")),
        List.of(new Recipient(new EmailAddress("to@example.com", "받는사람"))),
        List.of(),
        "2026-10-01T10:00:00Z",
        "2026-10-01T09:55:00Z",
        true,
        false,
        "<msg-" + id + "@example.com>",
        "conv-" + id,
        null);
  }
}
