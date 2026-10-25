package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.mail.dto.MailFolderSyncResult;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.folder.MailFolderService;
import com.workplace.mail.service.graph.GraphDeltaPage;
import com.workplace.mail.service.graph.GraphMessage;
import com.workplace.mail.service.graph.GraphMessage.EmailAddress;
import com.workplace.mail.service.graph.GraphMessage.Recipient;
import com.workplace.mail.service.graph.GraphMessageMapper;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.net.URI;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메일함별 동기화(WP-960 Pass B) Graph 통합 테스트. {@link GraphApiClient}·{@link GraphTokenService} 를 스텁하고 사용자
 * 폴더 「프로젝트」(id-proj)의 첫 delta(최근 90일 필터)·저장된 deltaLink 증분·{@code @removed} 의 폴더 한정 삭제·이전 메일 더
 * 가져오기(기간 필터 + nextLink 페이징)의 요청 URL 과 결과를 본다.
 */
@Transactional
class MailFolderSyncGraphTest extends IntegrationTestBase {

  private static final String TOKEN = "FAKE_TOKEN";
  private static final String SELECT =
      "$select=subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,"
          + "hasAttachments,internetMessageId,conversationId";

  @Autowired DSLContext dsl;
  @Autowired MailFolderService folderService;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;

  @MockitoBean GraphApiClient graphApiClient;
  @MockitoBean GraphTokenService graphTokenService;

  private GraphMessage message(String id, String subject) {
    return new GraphMessage(
        id,
        subject,
        new Recipient(new EmailAddress("sender@example.com", "보낸사람")),
        List.of(new Recipient(new EmailAddress("to@example.com", "받는사람"))),
        List.of(),
        "2026-10-01T10:00:00Z",
        "2026-10-01T09:55:00Z",
        false,
        false,
        "<msg-" + id + "@example.com>",
        "conv-" + id,
        null);
  }

  private GraphMessage removed(String id) {
    return new GraphMessage(
        id,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        false,
        null,
        null,
        Map.of("reason", "deleted"));
  }

  /** Graph 계정 + 사용자 폴더 「프로젝트」(이름·remote_id = id-proj). [user, account, folderId] */
  private long[] setup() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    long folderId =
        folderRepo
            .upsertServerFolder(accountId, "id-proj", "id-proj", "프로젝트", "USER", true, 1, 3, null)
            .orElseThrow();
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn(TOKEN);
    return new long[] {user, accountId, folderId};
  }

  @Test
  void firstSync_usesFolderDeltaWith90DayFilter_thenSavedDeltaLink() {
    long[] s = setup();
    ArgumentCaptor<String> urls = ArgumentCaptor.forClass(String.class);
    when(graphApiClient.get(eq(TOKEN), urls.capture(), eq(GraphDeltaPage.class)))
        .thenReturn(
            new GraphDeltaPage(List.of(message("P1", "견적"), message("P2", "일정")), null, "DL-PROJ"));

    MailFolderSyncResult first = folderService.syncFolder(s[0], s[1], s[2], false);

    assertThat(first.saved()).isEqualTo(2);
    assertThat(first.syncedSince()).isNotNull();
    assertThat(first.syncedSince()).isEqualTo(first.syncedSince().truncatedTo(ChronoUnit.SECONDS));
    assertThat(first.syncedSince())
        .isBetween(
            Instant.now().minus(90, ChronoUnit.DAYS).minusSeconds(60),
            Instant.now().minus(90, ChronoUnit.DAYS));
    String expected =
        "/me/mailFolders/id-proj/messages/delta?"
            + SELECT
            + "&$filter=receivedDateTime%20ge%20"
            + first.syncedSince();
    assertThat(urls.getValue()).isEqualTo(expected);
    // GraphApiClient 는 URL 을 URI.create 로 그대로 쓴다 — 인코딩된 형태라 예외 없이 만들어져야 한다
    assertThat(URI.create("https://graph.microsoft.com/v1.0" + expected).getRawQuery())
        .contains("receivedDateTime%20ge%20");
    assertThat(folderRepo.getDeltaLink(s[2])).contains("DL-PROJ");
    assertThat(messageRepo.findByProviderId(s[1], s[2], "P1")).isPresent();

    // 두 번째는 저장된 deltaLink 그대로
    when(graphApiClient.get(eq(TOKEN), eq("DL-PROJ"), eq(GraphDeltaPage.class)))
        .thenReturn(new GraphDeltaPage(List.of(message("P3", "새 메일")), null, "DL-PROJ-2"));
    MailFolderSyncResult second = folderService.syncFolder(s[0], s[1], s[2], false);
    assertThat(second.saved()).isEqualTo(1);
    assertThat(second.syncedSince()).isEqualTo(first.syncedSince()); // 경계 불변
    assertThat(folderRepo.getDeltaLink(s[2])).contains("DL-PROJ-2");
  }

  @Test
  void removedInFolderDelta_deletesOnlyThisFoldersRow() {
    long[] s = setup();
    // 받은편지함에 있는 메일(INBOX-1)과 이 폴더의 메일(P1)
    long inbox = folderRepo.ensureFolder(s[1], "INBOX").id();
    ParsedMessage inInbox = GraphMessageMapper.toParsed(message("INBOX-1", "받은 메일"));
    messageRepo.upsertByProviderId(s[1], inbox, inInbox, "INBOX-1", true);
    ParsedMessage inFolder = GraphMessageMapper.toParsed(message("P1", "폴더 메일"));
    messageRepo.upsertByProviderId(s[1], s[2], inFolder, "P1", true);
    folderRepo.setDeltaLink(s[2], "DL-PROJ");
    folderRepo.markFolderSynced(
        s[2], java.time.OffsetDateTime.now().minusDays(90), java.time.OffsetDateTime.now());

    // 폴더 delta 가 두 id 모두 「이 폴더에서 빠짐」으로 알린다
    when(graphApiClient.get(eq(TOKEN), eq("DL-PROJ"), eq(GraphDeltaPage.class)))
        .thenReturn(new GraphDeltaPage(List.of(removed("P1"), removed("INBOX-1")), null, "DL-2"));

    MailFolderSyncResult r = folderService.syncFolder(s[0], s[1], s[2], false);

    assertThat(r.removed()).isEqualTo(1);
    assertThat(messageRepo.findByProviderId(s[1], s[2], "P1")).isEmpty();
    assertThat(messageRepo.findByProviderId(s[1], inbox, "INBOX-1")).isPresent();
  }

  @Test
  void older_pagesFilteredMessagesList_movesBoundary_andRestartsDeltaFromNewBoundary() {
    long[] s = setup();
    Instant since = Instant.parse("2026-07-27T08:15:30Z");
    folderRepo.setDeltaLink(s[2], "DL-PROJ");
    folderRepo.markFolderSynced(
        s[2], since.atOffset(java.time.ZoneOffset.UTC), java.time.OffsetDateTime.now());
    String expected =
        "/me/mailFolders/id-proj/messages?"
            + SELECT
            + "&$filter=receivedDateTime%20ge%202026-04-28T08:15:30Z"
            + "%20and%20receivedDateTime%20lt%202026-07-27T08:15:30Z"
            + "&$top=100";
    String next = "https://graph.microsoft.com/v1.0/me/mailFolders/id-proj/messages?$skiptoken=X";
    when(graphApiClient.get(TOKEN, expected, GraphDeltaPage.class))
        .thenReturn(new GraphDeltaPage(List.of(message("O1", "옛 메일 1")), next, null));
    when(graphApiClient.get(TOKEN, next, GraphDeltaPage.class))
        .thenReturn(new GraphDeltaPage(List.of(message("O2", "옛 메일 2")), null, null));

    MailFolderSyncResult r = folderService.syncFolder(s[0], s[1], s[2], true);

    assertThat(r.saved()).isEqualTo(2);
    assertThat(r.syncedSince()).isEqualTo(Instant.parse("2026-04-28T08:15:30Z"));
    // delta 커서는 지워진다 — 다음 동기화가 새 경계로 delta 를 다시 시작
    assertThat(folderRepo.getDeltaLink(s[2])).isEmpty();
    ArgumentCaptor<String> urls = ArgumentCaptor.forClass(String.class);
    verify(graphApiClient, atLeastOnce()).get(eq(TOKEN), urls.capture(), eq(GraphDeltaPage.class));
    assertThat(urls.getAllValues()).containsExactly(expected, next);
    assertThat(URI.create("https://graph.microsoft.com/v1.0" + expected)).isNotNull();
    assertThat(
            dsl.fetchCount(
                EMAIL_MESSAGE,
                EMAIL_MESSAGE
                    .FOLDER_ID
                    .eq(s[2])
                    .and(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID.in("O1", "O2"))))
        .isEqualTo(2);

    // 다음 폴더 동기화: 새 경계(2026-04-28T08:15:30Z)부터 초기 delta 를 다시 부르고, 경계는 그대로 둔다
    String restart =
        "/me/mailFolders/id-proj/messages/delta?"
            + SELECT
            + "&$filter=receivedDateTime%20ge%202026-04-28T08:15:30Z";
    when(graphApiClient.get(TOKEN, restart, GraphDeltaPage.class))
        .thenReturn(
            new GraphDeltaPage(
                List.of(message("O1", "옛 메일 1"), message("P9", "최근 메일")), null, "DL-NEW"));
    MailFolderSyncResult next2 = folderService.syncFolder(s[0], s[1], s[2], false);
    assertThat(next2.saved()).isEqualTo(1); // O1 은 이미 있음(멱등)
    assertThat(next2.syncedSince()).isEqualTo(Instant.parse("2026-04-28T08:15:30Z"));
    assertThat(folderRepo.getDeltaLink(s[2])).contains("DL-NEW");
    verify(graphApiClient).get(TOKEN, restart, GraphDeltaPage.class);
  }
}
