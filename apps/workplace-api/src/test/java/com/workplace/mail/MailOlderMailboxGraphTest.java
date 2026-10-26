package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailOlderResult;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.GraphMailFetcher;
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
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * 받은편지함·보낸편지함 이전 메일 더 가져오기(WP-965) Graph 통합 테스트. {@link GraphApiClient}·{@link GraphTokenService} 를
 * 스텁하고 받은편지함(well-known inbox)·서버 보낸편지함(sentitems)의 기간 필터 목록 URL, 더 있는지 확인 URL, 경계 이동, delta 커서 보존을
 * 본다.
 */
@Transactional
class MailOlderMailboxGraphTest extends IntegrationTestBase {

  private static final String TOKEN = "FAKE_TOKEN";
  private static final String SELECT =
      "$select=subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,"
          + "hasAttachments,internetMessageId,conversationId";

  @Autowired DSLContext dsl;
  @Autowired MailFolderService folderService;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired GraphMailFetcher graphMailFetcher;

  @MockitoBean GraphApiClient graphApiClient;
  @MockitoBean GraphTokenService graphTokenService;

  private GraphMessage message(String id, String subject, String received) {
    return new GraphMessage(
        id,
        subject,
        new Recipient(new EmailAddress("sender@example.com", "보낸사람")),
        List.of(new Recipient(new EmailAddress("to@example.com", "받는사람"))),
        List.of(),
        received,
        received,
        true,
        false,
        "<msg-" + id + "@example.com>",
        "conv-" + id,
        null);
  }

  /** Graph 계정. [user, account] */
  private long[] account() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn(TOKEN);
    return new long[] {user, accountId};
  }

  private void seed(long accountId, long folderId, GraphMessage m) {
    messageRepo.upsertByProviderId(
        accountId, folderId, GraphMessageMapper.toParsed(m), m.id(), true);
  }

  @Test
  void inbox_usesOldestLocalAsBoundary_keepsDelta_andProbesForMore() {
    long[] s = account();
    long inbox = folderRepo.ensureFolder(s[1], "INBOX").id();
    seed(s[1], inbox, message("N1", "최근", "2026-10-01T10:00:00Z"));
    seed(s[1], inbox, message("N2", "가장 오래된 로컬", "2026-09-01T00:00:00Z"));
    folderRepo.setDeltaLink(inbox, "DL-INBOX");

    String list =
        "/me/mailFolders/inbox/messages?"
            + SELECT
            + "&$filter=receivedDateTime%20ge%202026-06-03T00:00:00Z"
            + "%20and%20receivedDateTime%20lt%202026-09-01T00:00:00Z"
            + "&$top=100";
    String probe =
        "/me/mailFolders/inbox/messages?$select=id&$top=1"
            + "&$filter=receivedDateTime%20lt%202026-06-03T00:00:00Z";
    when(graphApiClient.get(TOKEN, list, GraphDeltaPage.class))
        .thenReturn(
            new GraphDeltaPage(List.of(message("O1", "옛 메일", "2026-07-15T00:00:00Z")), null, null));
    when(graphApiClient.get(TOKEN, probe, GraphDeltaPage.class))
        .thenReturn(
            new GraphDeltaPage(List.of(message("O0", null, "2026-01-01T00:00:00Z")), null, null));

    MailOlderResult r = folderService.fetchOlder(s[0], s[1], "INBOX");

    assertThat(r.saved()).isEqualTo(1);
    assertThat(r.syncedSince()).isEqualTo(Instant.parse("2026-06-03T00:00:00Z"));
    assertThat(r.hasMore()).isTrue();
    // 받은편지함 delta 는 기간 필터가 없다 — 지우면 받은편지함 전체를 다시 받으므로 그대로
    assertThat(folderRepo.getDeltaLink(inbox)).contains("DL-INBOX");
    assertThat(folderRepo.findMailboxTarget(s[1], "INBOX").orElseThrow().syncedSince())
        .isEqualTo(OffsetDateTime.parse("2026-06-03T00:00:00Z"));
    ArgumentCaptor<String> urls = ArgumentCaptor.forClass(String.class);
    verify(graphApiClient, atLeastOnce()).get(eq(TOKEN), urls.capture(), eq(GraphDeltaPage.class));
    assertThat(urls.getAllValues()).containsExactly(list, probe);
    // GraphApiClient 는 URL 을 URI.create 로 그대로 쓴다 — 인코딩된 형태여야 한다
    assertThat(URI.create("https://graph.microsoft.com/v1.0" + probe)).isNotNull();
    assertThat(messageRepo.findByProviderId(s[1], inbox, "O1")).isPresent();
  }

  @Test
  void sent_usesStoredBoundaryOnSentItems_andReportsNoMore() {
    long[] s = account();
    long sent = folderRepo.ensureServerSentFolder(s[1], "sentitems").orElseThrow().id();
    folderRepo.markFolderSynced(
        sent, Instant.parse("2026-10-18T00:00:00Z").atOffset(ZoneOffset.UTC), OffsetDateTime.now());
    folderRepo.setDeltaLink(sent, "DL-SENT");

    String list =
        "/me/mailFolders/sentitems/messages?"
            + SELECT
            + "&$filter=receivedDateTime%20ge%202026-07-20T00:00:00Z"
            + "%20and%20receivedDateTime%20lt%202026-10-18T00:00:00Z"
            + "&$top=100";
    when(graphApiClient.get(TOKEN, list, GraphDeltaPage.class))
        .thenReturn(
            new GraphDeltaPage(
                List.of(
                    message("S1", "지난달 보낸 메일", "2026-09-20T00:00:00Z"),
                    message("S2", "석 달 전 보낸 메일", "2026-07-21T00:00:00Z")),
                null,
                null));
    // 더 있는지 확인 — 빈 목록
    String probe =
        "/me/mailFolders/sentitems/messages?$select=id&$top=1"
            + "&$filter=receivedDateTime%20lt%202026-07-20T00:00:00Z";
    when(graphApiClient.get(TOKEN, probe, GraphDeltaPage.class))
        .thenReturn(new GraphDeltaPage(List.of(), null, null));

    MailOlderResult r = folderService.fetchOlder(s[0], s[1], "SENT");

    assertThat(r.saved()).isEqualTo(2);
    assertThat(r.hasMore()).isFalse();
    assertThat(r.syncedSince()).isEqualTo(Instant.parse("2026-07-20T00:00:00Z"));
    // 보낸편지함 delta 는 기간 필터가 있다 — 지워서 다음 동기화가 새 경계부터 delta 를 다시 시작한다(옛 메일의 읽음·삭제도 받게)
    assertThat(folderRepo.getDeltaLink(sent)).isEmpty();
    // 보낸편지함 보기(앱 발송 기록 + 서버 보낸편지함)에 보인다
    assertThat(
            messageRepo.listByAccount(s[1], "SENT", null, 50).stream()
                .map(EmailMessageSummary::subject))
        .containsExactly("지난달 보낸 메일", "석 달 전 보낸 메일");
  }

  /**
   * 받기는 끝났는데 더 있는지 확인만 실패하면 오류(502)로 돌려 화면이 「다시 시도」를 보인다 — 더 있다고 짐작하면 확인이 계속 실패할 때 화면이 끝없이 거슬러 받는다.
   * 받은 메일과 옮긴 경계는 남아 다시 시도가 새 경계부터 잇는다.
   */
  @Test
  void probeFailure_failsTheRequest_butKeepsFetchedMailAndBoundary() {
    long[] s = account();
    long inbox = folderRepo.ensureFolder(s[1], "INBOX").id();
    seed(s[1], inbox, message("N1", "가장 오래된 로컬", "2026-09-01T00:00:00Z"));
    String list =
        "/me/mailFolders/inbox/messages?"
            + SELECT
            + "&$filter=receivedDateTime%20ge%202026-06-03T00:00:00Z"
            + "%20and%20receivedDateTime%20lt%202026-09-01T00:00:00Z"
            + "&$top=100";
    String probe =
        "/me/mailFolders/inbox/messages?$select=id&$top=1"
            + "&$filter=receivedDateTime%20lt%202026-06-03T00:00:00Z";
    when(graphApiClient.get(TOKEN, list, GraphDeltaPage.class))
        .thenReturn(
            new GraphDeltaPage(List.of(message("O1", "옛 메일", "2026-07-15T00:00:00Z")), null, null));
    when(graphApiClient.get(TOKEN, probe, GraphDeltaPage.class))
        .thenThrow(new IllegalStateException("429 Too Many Requests"));

    assertThatThrownBy(() -> folderService.fetchOlder(s[0], s[1], "INBOX"))
        .isInstanceOf(MailSyncException.class);

    assertThat(messageRepo.findByProviderId(s[1], inbox, "O1")).isPresent();
    assertThat(folderRepo.findMailboxTarget(s[1], "INBOX").orElseThrow().syncedSince())
        .isEqualTo(OffsetDateTime.parse("2026-06-03T00:00:00Z"));
  }

  /** 이전 메일을 받은 뒤 보낸편지함 delta 는 저장된 경계부터 다시 시작한다 — 이어 받은 옛 보낸 메일의 읽음·삭제도 delta 로 받는다. */
  @Test
  void sentDelta_restartsFromStoredBoundary() {
    long[] s = account();
    long sent = folderRepo.ensureServerSentFolder(s[1], "sentitems").orElseThrow().id();
    folderRepo.markFolderSynced(
        sent, Instant.parse("2026-07-20T00:00:00Z").atOffset(ZoneOffset.UTC), OffsetDateTime.now());
    when(graphApiClient.get(
            eq(TOKEN),
            startsWith("/me/mailFolders/inbox/messages/delta"),
            eq(GraphDeltaPage.class)))
        .thenReturn(new GraphDeltaPage(List.of(), null, "DL-INBOX"));
    String restart =
        "/me/mailFolders/sentitems/messages/delta?"
            + SELECT
            + "&$filter=receivedDateTime%20ge%202026-07-20T00:00:00Z";
    when(graphApiClient.get(TOKEN, restart, GraphDeltaPage.class))
        .thenReturn(new GraphDeltaPage(List.of(), null, "DL-SENT-NEW"));

    graphMailFetcher.fetchNewMessages(
        s[0], s[1], accountRepo.findByIdAndUser(s[0], s[1]).orElseThrow());

    verify(graphApiClient).get(TOKEN, restart, GraphDeltaPage.class);
    assertThat(folderRepo.getDeltaLink(sent)).contains("DL-SENT-NEW");
  }
}
