package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.GraphMailFetcher;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.graph.GraphDeltaPage;
import com.workplace.mail.service.graph.GraphMessage;
import com.workplace.mail.service.graph.GraphMessage.EmailAddress;
import com.workplace.mail.service.graph.GraphMessage.Flag;
import com.workplace.mail.service.graph.GraphMessage.Recipient;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1741 Graph 별표 받아오기 — delta $select 에 flag 를 넣고, flagStatus 를 별표로 옮긴다(flagged → true,
 * complete·notFlagged → false, 누락 → 건드리지 않음). 별표 반영 대기 행은 서버 값으로 덮지 않고, 읽음 대기와 별표 대기는 서로의 갱신을 막지
 * 않는다.
 */
@Transactional
class GraphFlagSyncTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired GraphMailFetcher graphMailFetcher;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;
  @Autowired GraphApiClient graphApiClient;
  @Autowired GraphTokenService graphTokenService;
  @Autowired ObjectMapper objectMapper;

  private long seedGraphAccount(long userId) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "graph-flag-" + userId + "@example.com")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "Graph 별표 계정")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("FAKE_TOKEN"))
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  private EmailAccountResponse accountOf(long accountId) {
    return new EmailAccountResponse(
        accountId,
        "graph@example.com",
        "Graph 계정",
        null,
        null,
        MailSecurity.NONE,
        null,
        null,
        null,
        MailSecurity.NONE,
        null,
        null,
        Instant.now(),
        Instant.now(),
        false,
        null,
        MailProvider.M365_GRAPH);
  }

  /** 읽음·flagStatus 를 지정한 delta 항목. flagStatus 가 null 이면 flag 가 빠진 항목을 흉내 낸다. */
  private static GraphMessage message(String id, Boolean isRead, String flagStatus) {
    return new GraphMessage(
        id,
        "제목 " + id,
        new Recipient(new EmailAddress("sender@example.com", "보낸사람")),
        List.of(new Recipient(new EmailAddress("to@example.com", "받는사람"))),
        List.of(),
        "2024-01-01T10:00:00Z",
        "2024-01-01T09:55:00Z",
        isRead,
        false,
        "<msg-" + id + "@example.com>",
        "conv-" + id,
        null,
        flagStatus == null ? null : new Flag(flagStatus));
  }

  private long inboxId(long accountId) {
    return folderRepo.ensureFolder(accountId, "INBOX").id();
  }

  private long idOf(long accountId, String providerId) {
    return messageRepo.findByProviderId(accountId, inboxId(accountId), providerId).orElseThrow();
  }

  private boolean flagged(long id) {
    return dsl.select(EMAIL_MESSAGE.FLAGGED)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(id))
        .fetchOne(EMAIL_MESSAGE.FLAGGED);
  }

  private boolean seen(long id) {
    return dsl.select(EMAIL_MESSAGE.SEEN)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(id))
        .fetchOne(EMAIL_MESSAGE.SEEN);
  }

  /** 첫 delta(신규)와 이후 delta(기존 행 갱신) 모두 flagStatus 를 별표로 옮긴다. 누락은 기존 값을 건드리지 않는다. */
  @Test
  void flagStatus_mapsToFlagged_onInsertAndUpdate() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId);
    when(graphTokenService.getAccessToken(userId, accountId)).thenReturn("FAKE_TOKEN");
    when(graphApiClient.get(eq("FAKE_TOKEN"), any(String.class), eq(GraphDeltaPage.class)))
        .thenReturn(
            new GraphDeltaPage(
                List.of(
                    message("F1", false, "flagged"),
                    message("F2", false, "complete"),
                    message("F3", false, "notFlagged"),
                    message("F4", false, null)),
                null,
                "D1"));
    when(graphApiClient.get(eq("FAKE_TOKEN"), eq("D1"), eq(GraphDeltaPage.class)))
        .thenReturn(
            new GraphDeltaPage(
                List.of(
                    message("F1", false, "complete"), // 완료 처리 → 별표 아님
                    message("F2", false, "flagged"),
                    message("F3", false, null)), // flag 누락 — 건드리지 않음
                null,
                "D2"));

    graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));

    // delta 가 flag 를 요청한다(받은편지함 초기 URL)
    verify(graphApiClient, org.mockito.Mockito.atLeastOnce())
        .get(
            eq("FAKE_TOKEN"),
            org.mockito.ArgumentMatchers.contains("conversationId,flag"),
            eq(GraphDeltaPage.class));
    assertThat(flagged(idOf(accountId, "F1"))).isTrue();
    assertThat(flagged(idOf(accountId, "F2"))).isFalse();
    assertThat(flagged(idOf(accountId, "F3"))).isFalse();
    assertThat(flagged(idOf(accountId, "F4"))).isFalse();

    MailSyncResult second =
        graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));

    assertThat(flagged(idOf(accountId, "F1"))).isFalse();
    assertThat(flagged(idOf(accountId, "F2"))).isTrue();
    assertThat(flagged(idOf(accountId, "F3"))).isFalse();
    // 별표 변화도 상태 변화로 센다 — 목록 변경 알림 근거
    assertThat(second.seenChanged()).isEqualTo(2);
  }

  /** flag 는 JSON 에 있으면 flagStatus 로, 없으면 null 로 역직렬화된다(누락 감지의 전제). */
  @Test
  void graphMessage_parsesFlagPresentAndMissing() throws Exception {
    GraphMessage flagged =
        objectMapper.readValue(
            "{\"id\":\"R1\",\"flag\":{\"flagStatus\":\"flagged\",\"dueDateTime\":null}}",
            GraphMessage.class);
    GraphMessage missing = objectMapper.readValue("{\"id\":\"R2\"}", GraphMessage.class);

    assertThat(flagged.flag().flagStatus()).isEqualTo("flagged");
    assertThat(missing.flag()).isNull();
  }

  /**
   * 별표 반영 대기 행은 서버 flag 로 덮지 않고(풀린 뒤에는 따른다), 읽음 반영 대기 행이라도 서버 별표는 들어오며, 별표 반영 대기 행이라도 서버 읽음은 들어온다.
   */
  @Test
  void pendingFlag_notOverwritten_andAttributesIndependent() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId);
    when(graphTokenService.getAccessToken(userId, accountId)).thenReturn("FAKE_TOKEN");
    when(graphApiClient.get(eq("FAKE_TOKEN"), any(String.class), eq(GraphDeltaPage.class)))
        .thenReturn(
            new GraphDeltaPage(
                List.of(message("P1", false, "notFlagged"), message("P2", false, "notFlagged")),
                null,
                "D1"));
    // 서버: P1 은 별표 해제 상태 그대로(+ 읽음), P2 는 별표가 켜짐(읽음은 그대로)
    GraphDeltaPage next =
        new GraphDeltaPage(
            List.of(message("P1", true, "notFlagged"), message("P2", false, "flagged")),
            null,
            "D1");
    when(graphApiClient.get(eq("FAKE_TOKEN"), eq("D1"), eq(GraphDeltaPage.class))).thenReturn(next);

    graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));
    long p1 = idOf(accountId, "P1");
    long p2 = idOf(accountId, "P2");
    messageRepo.markFlagged(p1, true); // P1: 로컬 별표 — 별표 반영 대기
    messageRepo.markSeen(p2); // P2: 로컬 열람 — 읽음 반영 대기

    graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));

    // P1: 별표 대기라 서버 notFlagged 로 되돌리지 않지만, 읽음은 서버(true)를 따른다
    assertThat(flagged(p1)).isTrue();
    assertThat(seen(p1)).isTrue();
    // P2: 읽음 대기라 서버 isRead=false 로 되돌리지 않지만, 별표는 서버(flagged)를 따른다
    assertThat(seen(p2)).isTrue();
    assertThat(flagged(p2)).isTrue();

    // 별표 반영이 끝나 대기가 풀리면 그 뒤 동기화는 서버 값을 따른다
    messageRepo.clearFlaggedPushPendingIn(List.of(p1), true);
    graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));
    assertThat(flagged(p1)).isFalse();
  }
}
