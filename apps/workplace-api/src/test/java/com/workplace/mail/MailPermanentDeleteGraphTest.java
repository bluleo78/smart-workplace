package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.workplace.mail.dto.MailMoveResponse;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphBatchRequest;
import com.workplace.mail.outbound.GraphBatchResponse;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailServerErrors;
import com.workplace.mail.service.graph.GraphMailFolder;
import com.workplace.mail.service.trash.MailTrashService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.node.JsonNodeFactory;

/**
 * 휴지통 메일 완전히 삭제(WP-1682) Outlook(Graph) 통합 테스트 — {@link GraphApiClient}·{@link GraphTokenService} 를
 * 스텁하고({@code MailMoveGraphTest} 방식) $batch 로 보내는 permanentDelete 요청(폴더 범위 URL·POST·빈 본문·20건 묶음)과
 * 결과별 로컬 반영을 본다. 204·404 는 성공(로컬 행 삭제), 그 밖은 실패(행 유지)이고, 한 통 경로는 다시 보내지 않는다. batch 최상위 실패는 그 묶음과 뒤
 * 묶음만 실패로 두고 앞 묶음 결과는 유지한다.
 *
 * <p>지우기 전에 묶음마다 위치 확인 GET({@code /me/messages/{id}?$select=id,parentFolderId})을 같은 $batch 로 보낸다 —
 * 스텁은 GET 요청에 기본으로 「지운 편지함에 있음」을 답하고({@link #locate} 로 바꾼다), POST(permanentDelete) 요청만 {@link
 * #batches} 에 쌓는다.
 */
@Transactional
class MailPermanentDeleteGraphTest extends ExternalClientMockedTestBase {

  private static final String TOKEN = "FAKE_TOKEN";

  @Autowired DSLContext dsl;
  @Autowired MailTrashService trashService;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired GraphApiClient graphApiClient;
  @Autowired GraphTokenService graphTokenService;

  /** 지운 편지함의 Graph 폴더 id(스텁). */
  private static final String TRASH_FOLDER_ID = "FOLDER-DELETED";

  /** 보낸 permanentDelete batch 요청 묶음(호출 순서대로) — 위치 확인 GET 은 담지 않는다. */
  private final List<List<GraphBatchRequest>> batches = new ArrayList<>();

  /** 위치 확인 GET 응답(Graph id → 응답, 요청 id 는 스텁이 맞춘다) — 기본은 지운 편지함에 있음. */
  private Function<String, GraphBatchResponse> locate = pid -> locatedIn(TRASH_FOLDER_ID);

  /** [user, account, inboxFolderId, trashFolderId] — Graph 계정과 받은편지함·휴지통(role TRASH) 행. */
  private long[] setup() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long trash =
        folderRepo
            .upsertServerFolder(
                accountId, "id-trash", "id-trash", "Deleted Items", "TRASH", true, null, null, null)
            .orElseThrow();
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn(TOKEN);
    when(graphApiClient.get(
            eq(TOKEN), eq("/me/mailFolders/deleteditems?$select=id"), eq(GraphMailFolder.class)))
        .thenReturn(new GraphMailFolder(TRASH_FOLDER_ID, null, null, null, null, null, null, null));
    return new long[] {user, accountId, inbox, trash};
  }

  private long seed(long accountId, long folderId, String providerId) {
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID, providerId)
        .set(EMAIL_MESSAGE.THREAD_ID, "thread-" + providerId)
        .set(EMAIL_MESSAGE.SEEN, true)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /**
   * batch 스텁 — 위치 확인 GET 은 {@link #locate} 로, permanentDelete 는 reply 로 요청마다 응답을 정한다.
   * permanentDelete 요청 묶음은 {@link #batches} 에 쌓는다.
   */
  private void stubBatch(Function<GraphBatchRequest, GraphBatchResponse> reply) {
    when(graphApiClient.batch(eq(TOKEN), any()))
        .thenAnswer(inv -> answer(inv.getArgument(1), reply));
  }

  /** 한 batch 의 응답 — GET 이면 위치 확인 응답, 아니면 permanentDelete 묶음으로 기록하고 reply. */
  private List<GraphBatchResponse> answer(
      List<GraphBatchRequest> reqs, Function<GraphBatchRequest, GraphBatchResponse> reply) {
    if (isLocate(reqs)) {
      return reqs.stream().map(r -> withId(r.id(), locate.apply(providerIdOf(r)))).toList();
    }
    batches.add(reqs);
    return reqs.stream().map(reply).toList();
  }

  /** 위치 확인 GET 묶음인지. */
  private static boolean isLocate(List<GraphBatchRequest> reqs) {
    return !reqs.isEmpty() && "GET".equals(reqs.get(0).method());
  }

  /** 위치 확인 200 응답 — 메일이 folderId 메일함에 있다. */
  private static GraphBatchResponse locatedIn(String folderId) {
    return new GraphBatchResponse(
        "", 200, JsonNodeFactory.instance.objectNode().put("parentFolderId", folderId));
  }

  private static GraphBatchResponse withId(String id, GraphBatchResponse g) {
    return new GraphBatchResponse(id, g.status(), g.body(), g.retryAfterSeconds());
  }

  /** permanentDelete·위치 확인 요청 URL 에서 Graph 메시지 id 를 꺼낸다. */
  private static String providerIdOf(GraphBatchRequest r) {
    return r.url()
        .replace("/me/mailFolders/deleteditems/messages/", "")
        .replace("/permanentDelete", "")
        .replace("/me/messages/", "")
        .replace("?$select=id,parentFolderId", "");
  }

  @Test
  void erase_sendsPermanentDeleteInBatchesOf20_successAnd404Ok_500Fails() {
    long[] s = setup();
    List<Long> ids = new ArrayList<>();
    for (int i = 0; i < 45; i++) {
      ids.add(seed(s[1], s[3], "P" + i));
    }
    long inboxMail = seed(s[1], s[2], "IN1"); // 휴지통 밖 — 그대로 남아야 한다
    stubBatch(
        r ->
            switch (providerIdOf(r)) {
              case "P7" -> new GraphBatchResponse(r.id(), 404); // 다른 곳에서 이미 지웠다 — 목표 상태
              case "P13" -> new GraphBatchResponse(r.id(), 500);
              default -> new GraphBatchResponse(r.id(), 204);
            });

    MailMoveResponse res = trashService.permanentDelete(s[0], s[1], ids);

    assertThat(batches).extracting(List::size).containsExactly(20, 20, 5);
    List<String> sent = new ArrayList<>();
    batches.forEach(
        b ->
            b.forEach(
                q -> {
                  String pid = providerIdOf(q);
                  sent.add(pid);
                  assertThat(q.url())
                      .isEqualTo(
                          "/me/mailFolders/deleteditems/messages/" + pid + "/permanentDelete");
                  assertThat(q.method()).isEqualTo("POST");
                  assertThat(q.body()).isEqualTo(Map.of());
                }));
    assertThat(sent).hasSize(45).doesNotHaveDuplicates();

    long failedId = ids.get(13);
    assertThat(res.results()).extracting(MailMoveResponse.Result::messageId).isEqualTo(ids);
    assertThat(res.results())
        .filteredOn(r -> r.messageId() != failedId)
        .allSatisfy(
            r -> {
              assertThat(r.ok()).isTrue();
              assertThat(r.error()).isNull();
            });
    assertThat(res.results())
        .filteredOn(r -> r.messageId() == failedId)
        .singleElement()
        .satisfies(
            r -> {
              assertThat(r.ok()).isFalse();
              assertThat(r.error()).isEqualTo(MailServerErrors.ERASE_FAILED);
            });
    // 성공(204·404)만 로컬에서 지우고, 실패한 메일·휴지통 밖 메일은 그대로
    assertThat(dsl.fetchCount(EMAIL_MESSAGE, EMAIL_MESSAGE.FOLDER_ID.eq(s[3]))).isEqualTo(1);
    assertThat(rowExists(failedId)).isTrue();
    assertThat(rowExists(ids.get(7))).isFalse();
    assertThat(rowExists(inboxMail)).isTrue();
  }

  /** batch 최상위 실패(429·5xx·네트워크)는 그 묶음과 뒤 묶음을 보내지 않고 실패로 두며, 이미 지운 앞 묶음 결과·로컬 반영은 유지한다. */
  @Test
  void topLevelBatchFailure_failsThatChunkAndRest_keepsEarlierResults() {
    long[] s = setup();
    List<Long> ids = new ArrayList<>();
    for (int i = 0; i < 45; i++) {
      ids.add(seed(s[1], s[3], "P" + i));
    }
    // 위치 확인은 늘 답하고, permanentDelete 는 첫 묶음만 받고 둘째 묶음부터 최상위 실패
    when(graphApiClient.batch(eq(TOKEN), any()))
        .thenAnswer(
            inv -> {
              List<GraphBatchRequest> reqs = inv.getArgument(1);
              if (!isLocate(reqs) && !batches.isEmpty()) {
                throw new MailSendException("batch 실패");
              }
              return answer(reqs, r -> new GraphBatchResponse(r.id(), 204));
            });

    MailMoveResponse res = trashService.permanentDelete(s[0], s[1], ids);

    assertThat(batches).hasSize(1); // 둘째 묶음에서 실패 — 셋째 묶음은 보내지 않는다
    List<Long> first = batches.get(0).stream().map(q -> Long.parseLong(q.id())).toList();
    assertThat(first).hasSize(20);
    assertThat(res.results())
        .allSatisfy(
            r -> {
              if (first.contains(r.messageId())) {
                assertThat(r.ok()).isTrue();
                assertThat(rowExists(r.messageId())).isFalse();
              } else {
                assertThat(r.ok()).isFalse();
                assertThat(r.error()).isEqualTo(MailServerErrors.ERASE_FAILED);
                assertThat(rowExists(r.messageId())).isTrue();
              }
            });
    assertThat(res.results()).filteredOn(MailMoveResponse.Result::ok).hasSize(20);
  }

  /** Graph id 가 없는 로컬 행은 서버에서 찾을 수 없다 — batch 에 싣지 않고 실패, 행은 그대로. */
  @Test
  void missingProviderId_failsNotFound() {
    long[] s = setup();
    long noId = seed(s[1], s[3], null);
    long withId = seed(s[1], s[3], "G1");
    stubBatch(r -> new GraphBatchResponse(r.id(), 204));

    MailMoveResponse res = trashService.permanentDelete(s[0], s[1], List.of(noId, withId));

    assertThat(batches)
        .singleElement()
        .satisfies(
            b -> assertThat(b).extracting(GraphBatchRequest::id).containsExactly("" + withId));
    assertThat(res.results())
        .extracting(
            MailMoveResponse.Result::messageId,
            MailMoveResponse.Result::ok,
            MailMoveResponse.Result::error)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple(noId, false, MailServerErrors.NOT_FOUND),
            org.assertj.core.groups.Tuple.tuple(withId, true, null));
    assertThat(rowExists(noId)).isTrue();
    assertThat(rowExists(withId)).isFalse();
  }

  /** 응답에 빠진 항목은 지웠는지 몰라 실패로 두고 로컬 행도 그대로 둔다. */
  @Test
  void itemMissingFromResponse_fails() {
    long[] s = setup();
    long answered = seed(s[1], s[3], "G1");
    long missing = seed(s[1], s[3], "G2");
    // G2 는 위치 확인 응답에서 빠진다 — 지우기 요청도 보내지 않는다
    when(graphApiClient.batch(eq(TOKEN), any()))
        .thenAnswer(
            inv -> {
              List<GraphBatchRequest> reqs = inv.getArgument(1);
              List<GraphBatchResponse> all = answer(reqs, r -> new GraphBatchResponse(r.id(), 204));
              List<String> g1 =
                  reqs.stream()
                      .filter(r -> providerIdOf(r).equals("G1"))
                      .map(GraphBatchRequest::id)
                      .toList();
              return all.stream().filter(r -> g1.contains(r.id())).toList();
            });

    MailMoveResponse res = trashService.permanentDelete(s[0], s[1], List.of(answered, missing));

    assertThat(res.results())
        .extracting(
            MailMoveResponse.Result::messageId,
            MailMoveResponse.Result::ok,
            MailMoveResponse.Result::error)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple(answered, true, null),
            org.assertj.core.groups.Tuple.tuple(missing, false, MailServerErrors.ERASE_FAILED));
    assertThat(rowExists(answered)).isFalse();
    assertThat(rowExists(missing)).isTrue();
  }

  /**
   * Graph 는 폴더 범위 경로여도 메시지 id 로 찾아 지운다 — 그래서 지우기 전에 위치를 확인한다. 다른 메일 앱이 받은편지함으로 옮긴 메일(낡은 로컬 휴지통 행)은
   * permanentDelete 를 보내지 않고 「메일함이 바뀌었습니다」 실패(행 유지), 확인 404(이미 없음)는 지우기 없이 성공(행 삭제)이다. 지운 편지함에 있는
   * 메일만 지운다.
   */
  @Test
  void messageMovedOutOfTrash_isNotDeleted_failsMailboxChanged() {
    long[] s = setup();
    long inTrash = seed(s[1], s[3], "T1");
    long moved = seed(s[1], s[3], "M1");
    long gone = seed(s[1], s[3], "X1");
    locate =
        pid ->
            switch (pid) {
              case "M1" -> locatedIn("FOLDER-INBOX");
              case "X1" -> new GraphBatchResponse("", 404);
              default -> locatedIn(TRASH_FOLDER_ID);
            };
    stubBatch(r -> new GraphBatchResponse(r.id(), 204));

    MailMoveResponse res = trashService.permanentDelete(s[0], s[1], List.of(inTrash, moved, gone));

    assertThat(batches)
        .singleElement()
        .satisfies(b -> assertThat(b).extracting(r -> providerIdOf(r)).containsExactly("T1"));
    assertThat(res.results())
        .extracting(
            MailMoveResponse.Result::messageId,
            MailMoveResponse.Result::ok,
            MailMoveResponse.Result::error)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple(inTrash, true, null),
            org.assertj.core.groups.Tuple.tuple(moved, false, MailServerErrors.MAILBOX_CHANGED),
            org.assertj.core.groups.Tuple.tuple(gone, true, null));
    assertThat(rowExists(inTrash)).isFalse();
    assertThat(rowExists(moved)).isTrue();
    assertThat(rowExists(gone)).isFalse();
  }

  private boolean rowExists(long id) {
    return dsl.fetchExists(EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(id));
  }
}
