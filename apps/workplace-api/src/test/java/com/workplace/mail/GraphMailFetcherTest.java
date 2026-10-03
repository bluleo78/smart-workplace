package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
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
import com.workplace.mail.service.graph.GraphMessage.Recipient;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * GraphMailFetcher 통합 테스트.
 *
 * <p>실제 AAD / Graph HTTP 호출 없이 {@link GraphApiClient}와 {@link GraphTokenService}를 @MockitoBean 으로
 * 스텁한다. 두 페이지(page1: nextLink + 메시지 G1·G2, page2: deltaLink + @removed G1) 시나리오로 delta 루프·제거·커서 보관을
 * 검증한다.
 */
@Transactional
class GraphMailFetcherTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired GraphMailFetcher graphMailFetcher;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  /** 실제 Graph API 호출 차단 — delta page DTO 를 직접 반환하도록 스텁. */
  @MockitoBean GraphApiClient graphApiClient;

  /** 실제 AAD 토큰 갱신 차단 — "FAKE_TOKEN" 반환. */
  @MockitoBean GraphTokenService graphTokenService;

  /** JSON 역직렬화 연기(@JsonProperty 애노테이션 검증). 별도 @Test 로 분리해 fragile 매핑을 커버한다. */
  @Autowired ObjectMapper objectMapper;

  /**
   * M365_GRAPH 계정을 test DB 에 직접 삽입하고 accountId 를 반환한다.
   *
   * <p>V90 에서 IMAP 컬럼이 nullable 로 완화됐으므로 OAuth 계정은 IMAP 관련 값 없이 삽입한다.
   */
  private long seedGraphAccount(long userId) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "graph-" + userId + "@example.com")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "Graph 테스트 계정")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("FAKE_TOKEN"))
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /** accountId 에 해당하는 EmailAccountResponse DTO(provider=M365_GRAPH). */
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

  /** 헬퍼: 신규(삭제 아님) GraphMessage 생성 — 기본 보낸사람·안읽음. */
  private GraphMessage message(String id, String subject) {
    return message(id, subject, "sender@example.com", false);
  }

  /** 헬퍼: 보낸사람·읽음 여부를 지정한 GraphMessage. isRead 가 null 이면 delta 응답에 isRead 가 빠진 항목을 흉내 낸다(WP-148). */
  private GraphMessage message(String id, String subject, String fromAddress, Boolean isRead) {
    Recipient from = new Recipient(new EmailAddress(fromAddress, "보낸사람"));
    return new GraphMessage(
        id,
        subject,
        from,
        List.of(new Recipient(new EmailAddress("to@example.com", "받는사람"))),
        List.of(),
        "2024-01-01T10:00:00Z",
        "2024-01-01T09:55:00Z",
        isRead,
        false,
        "<msg-" + id + "@example.com>",
        "conv-" + id,
        null /* @removed 없음 */);
  }

  /** 헬퍼: 메시지 행의 (seen, content_id, from_address, content.subject) 스냅샷 — 읽음 외 필드 불변 단언용. */
  private org.jooq.Record4<Boolean, Long, String, String> snapshot(long messageId) {
    return dsl.select(
            EMAIL_MESSAGE.SEEN,
            EMAIL_MESSAGE.CONTENT_ID,
            EMAIL_MESSAGE.FROM_ADDRESS,
            EMAIL_CONTENT.SUBJECT)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_CONTENT)
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .fetchOne();
  }

  /** 헬퍼: @removed 마커가 있는 GraphMessage(항목 삭제 지시). */
  private GraphMessage removedMessage(String id) {
    return new GraphMessage(
        id,
        null,
        null,
        null,
        null,
        null,
        null,
        false,
        false,
        null,
        null,
        java.util.Map.of("reason", "deleted") /* @removed 마커 */);
  }

  /**
   * delta 동기화의 핵심 시나리오: G1·G2 신규 삽입 → @removed G1 → G2 만 남고 deltaLink 가 보관된다.
   *
   * <p>page1: nextLink=NEXT_URL, 메시지 G1·G2<br>
   * page2: deltaLink=DELTA_LINK_VAL, @removed G1
   */
  @Test
  void fetchNewMessages_appliesDeltaAndRemovals() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId);

    // GraphTokenService 스텁 — getAccessToken 항상 "FAKE_TOKEN" 반환
    when(graphTokenService.getAccessToken(userId, accountId)).thenReturn("FAKE_TOKEN");

    // GraphApiClient 스텁 — page1: nextLink=NEXT_URL, 메시지 G1·G2
    GraphDeltaPage page1 =
        new GraphDeltaPage(List.of(message("G1", "제목1"), message("G2", "제목2")), "NEXT_URL", null);
    // page2: deltaLink=DELTA_LINK_VAL, @removed G1
    GraphDeltaPage page2 =
        new GraphDeltaPage(List.of(removedMessage("G1")), null, "DELTA_LINK_VAL");

    // 초기 delta URL(상수 형태)로 호출 시 page1 반환
    when(graphApiClient.get(eq("FAKE_TOKEN"), any(String.class), eq(GraphDeltaPage.class)))
        .thenReturn(page1);
    // nextLink URL 로 호출 시 page2 반환
    when(graphApiClient.get(eq("FAKE_TOKEN"), eq("NEXT_URL"), eq(GraphDeltaPage.class)))
        .thenReturn(page2);

    MailSyncResult r = graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));

    // G2 는 존재, G1 은 삭제됨
    assertThat(messageRepo.findByProviderId(accountId, "G2")).isPresent();
    assertThat(messageRepo.findByProviderId(accountId, "G1")).isEmpty();

    // deltaLink 가 폴더에 보관됨
    var folder = folderRepo.ensureFolder(accountId, "INBOX");
    assertThat(folderRepo.getDeltaLink(folder.id())).contains("DELTA_LINK_VAL");

    // G2 행은 imap_uid = null(Graph 계정은 IMAP UID 없음) 확인
    var g2Row = messageRepo.findByProviderId(accountId, "G2").orElseThrow();
    assertThat(
            dsl.select(EMAIL_MESSAGE.IMAP_UID)
                .from(EMAIL_MESSAGE)
                .where(EMAIL_MESSAGE.ID.eq(g2Row))
                .fetchOne(EMAIL_MESSAGE.IMAP_UID))
        .isNull();

    // 결과: 페이지1·2 처리(fetched=3: G1,G2,@removedG1), saved=2(G1 insert→G2 insert, G1 deleted)
    // fetched 는 구현별로 다를 수 있어 최소 저장 건수만 단언
    assertThat(r.saved()).isEqualTo(2);
  }

  /**
   * delta 커서가 있을 때 초기 URL 이 아닌 저장된 deltaLink 로 페이징을 시작한다.
   *
   * <p>두 번째 동기화(savedDelta="SAVED_DELTA")는 deltaLink 를 시작점으로 사용해야 한다.
   */
  @Test
  void fetchNewMessages_resumesDeltaLinkOnSecondSync() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId);

    when(graphTokenService.getAccessToken(userId, accountId)).thenReturn("FAKE_TOKEN");

    // 미리 폴더를 생성하고 deltaLink 를 심어 둔다
    var folder = folderRepo.ensureFolder(accountId, "INBOX");
    folderRepo.setDeltaLink(folder.id(), "SAVED_DELTA");

    // SAVED_DELTA URL 로 호출 시 신규 메시지 G3 + 새 deltaLink 반환
    GraphDeltaPage resumePage =
        new GraphDeltaPage(List.of(message("G3", "제목3")), null, "NEW_DELTA");
    when(graphApiClient.get(eq("FAKE_TOKEN"), eq("SAVED_DELTA"), eq(GraphDeltaPage.class)))
        .thenReturn(resumePage);

    graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));

    // G3 삽입 확인
    assertThat(messageRepo.findByProviderId(accountId, "G3")).isPresent();

    // deltaLink 가 NEW_DELTA 로 갱신됨
    var updatedFolder = folderRepo.ensureFolder(accountId, "INBOX");
    assertThat(folderRepo.getDeltaLink(updatedFolder.id())).contains("NEW_DELTA");
  }

  /**
   * {@link GraphDeltaPage}의 {@code @odata.nextLink} / {@code @odata.deltaLink} Jackson 매핑 검증.
   *
   * <p>@JsonProperty 애노테이션 오탈자는 MockitoBean 스텁에서는 발견 안 됨 — JSON 역직렬화 단계를 직접 실행한다.
   */
  @Test
  void graphDeltaPage_parsesOdataAnnotations() throws Exception {
    String json =
        """
        {
          "@odata.nextLink": "https://graph.microsoft.com/next",
          "@odata.deltaLink": null,
          "value": [
            {
              "id": "MSG1",
              "subject": "안녕",
              "from": { "emailAddress": { "address": "a@b.com", "name": "에이" } },
              "toRecipients": [],
              "ccRecipients": [],
              "receivedDateTime": "2024-01-01T10:00:00Z",
              "sentDateTime": "2024-01-01T09:55:00Z",
              "isRead": false,
              "hasAttachments": true,
              "internetMessageId": "<mid@example.com>",
              "conversationId": "conv1"
            }
          ]
        }
        """;

    GraphDeltaPage page = objectMapper.readValue(json, GraphDeltaPage.class);

    assertThat(page.nextLink()).isEqualTo("https://graph.microsoft.com/next");
    assertThat(page.deltaLink()).isNull();
    assertThat(page.value()).hasSize(1);
    GraphMessage m = page.value().get(0);
    assertThat(m.id()).isEqualTo("MSG1");
    assertThat(m.subject()).isEqualTo("안녕");
    assertThat(m.from().emailAddress().address()).isEqualTo("a@b.com");
    assertThat(m.hasAttachments()).isTrue();
    assertThat(m.removed()).isNull(); // @removed 없으면 null
  }

  /**
   * {@link GraphMessage}의 {@code @removed} 마커 Jackson 매핑 검증.
   *
   * <p>Graph delta 에서 삭제된 항목은 {@code "@removed":{"reason":"deleted"}} 를 포함한다.
   */
  @Test
  void graphMessage_parsesRemovedAnnotation() throws Exception {
    String json =
        """
        {
          "id": "DELETED1",
          "@removed": { "reason": "deleted" }
        }
        """;

    GraphMessage m = objectMapper.readValue(json, GraphMessage.class);

    assertThat(m.id()).isEqualTo("DELETED1");
    assertThat(m.removed()).isNotNull();
  }

  /**
   * WP-148: 이미 있는 메시지가 delta 로 다시 오면 seen 만 서버 isRead 로 갱신한다 — 제목·보낸사람·content 는 그대로이고, 새 메일로 세지
   * 않는다(saved=0). 서버에서 안읽음으로 되돌리면 로컬도 되돌린다(서버 기준).
   */
  @Test
  void fetchNewMessages_existingMessage_updatesSeenOnly() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId);
    when(graphTokenService.getAccessToken(userId, accountId)).thenReturn("FAKE_TOKEN");

    // 1차: 신규 G1(안읽음) → deltaLink D1
    when(graphApiClient.get(eq("FAKE_TOKEN"), any(String.class), eq(GraphDeltaPage.class)))
        .thenReturn(new GraphDeltaPage(List.of(message("G1", "원래 제목")), null, "D1"));
    // 2차(D1): 같은 G1 이 제목·보낸사람이 다르고 isRead=true 로 옴 → seen 만 반영돼야 함
    when(graphApiClient.get(eq("FAKE_TOKEN"), eq("D1"), eq(GraphDeltaPage.class)))
        .thenReturn(
            new GraphDeltaPage(
                List.of(message("G1", "바뀐 제목", "other@example.com", true)), null, "D2"));
    // 3차(D2): 서버에서 다시 안읽음으로 되돌림
    when(graphApiClient.get(eq("FAKE_TOKEN"), eq("D2"), eq(GraphDeltaPage.class)))
        .thenReturn(
            new GraphDeltaPage(
                List.of(message("G1", "바뀐 제목", "other@example.com", false)), null, "D3"));

    MailSyncResult first =
        graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));
    long g1 = messageRepo.findByProviderId(accountId, "G1").orElseThrow();
    var before = snapshot(g1);
    assertThat(first.saved()).isEqualTo(1);
    assertThat(before.value1()).isFalse();

    MailSyncResult second =
        graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));
    var afterRead = snapshot(g1);
    assertThat(second.saved()).isZero();
    assertThat(second.seenChanged()).isEqualTo(1);
    assertThat(afterRead.value1()).isTrue();
    // 읽음 외 필드는 1차 적재 값 그대로
    assertThat(afterRead.value2()).isEqualTo(before.value2());
    assertThat(afterRead.value3()).isEqualTo("sender@example.com");
    assertThat(afterRead.value4()).isEqualTo("원래 제목");

    MailSyncResult third =
        graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));
    assertThat(third.saved()).isZero();
    assertThat(third.seenChanged()).isEqualTo(1);
    assertThat(snapshot(g1).value1()).isFalse();
  }

  /** WP-148: 값이 같으면(서버도 안읽음) UPDATE 0건 — 읽음 변화로 세지 않아 불필요한 SSE 를 만들지 않는다. */
  @Test
  void fetchNewMessages_sameSeen_countsNothing() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId);
    when(graphTokenService.getAccessToken(userId, accountId)).thenReturn("FAKE_TOKEN");
    when(graphApiClient.get(eq("FAKE_TOKEN"), any(String.class), eq(GraphDeltaPage.class)))
        .thenReturn(new GraphDeltaPage(List.of(message("G1", "제목")), null, "D1"));
    when(graphApiClient.get(eq("FAKE_TOKEN"), eq("D1"), eq(GraphDeltaPage.class)))
        .thenReturn(new GraphDeltaPage(List.of(message("G1", "제목")), null, "D2"));

    graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));
    MailSyncResult second =
        graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));

    assertThat(second.saved()).isZero();
    assertThat(second.seenChanged()).isZero();
  }

  /** WP-148: delta 항목에 isRead 가 없으면(null) 기존 행의 읽음 상태를 건드리지 않는다 — 누락을 안읽음으로 오인하지 않기 위함. */
  @Test
  void fetchNewMessages_missingIsRead_leavesSeenUntouched() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId);
    when(graphTokenService.getAccessToken(userId, accountId)).thenReturn("FAKE_TOKEN");
    when(graphApiClient.get(eq("FAKE_TOKEN"), any(String.class), eq(GraphDeltaPage.class)))
        .thenReturn(
            new GraphDeltaPage(
                List.of(message("G1", "제목", "sender@example.com", true)), null, "D1"));
    when(graphApiClient.get(eq("FAKE_TOKEN"), eq("D1"), eq(GraphDeltaPage.class)))
        .thenReturn(
            new GraphDeltaPage(
                List.of(message("G1", "제목", "sender@example.com", null)), null, "D2"));

    graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));
    MailSyncResult second =
        graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));

    long g1 = messageRepo.findByProviderId(accountId, "G1").orElseThrow();
    assertThat(second.seenChanged()).isZero();
    assertThat(snapshot(g1).value1()).isTrue();
  }

  /** WP-148: isRead 는 JSON 에 있으면 그 값, 없으면 null 로 역직렬화된다(누락 감지의 전제). */
  @Test
  void graphMessage_parsesIsReadPresentAndMissing() throws Exception {
    GraphMessage read =
        objectMapper.readValue("{\"id\":\"R1\",\"isRead\":true}", GraphMessage.class);
    GraphMessage missing = objectMapper.readValue("{\"id\":\"R2\"}", GraphMessage.class);

    assertThat(read.isRead()).isTrue();
    assertThat(missing.isRead()).isNull();
  }

  /** WP-148: 로컬 열람의 서버 반영 대기(pending) 중에는 delta 의 isRead=false 가 seen 을 되돌리지 못하고, 대기가 풀리면 반영된다. */
  @Test
  void fetchNewMessages_pendingPush_notOverwrittenUntilCleared() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId);
    when(graphTokenService.getAccessToken(userId, accountId)).thenReturn("FAKE_TOKEN");
    when(graphApiClient.get(eq("FAKE_TOKEN"), any(String.class), eq(GraphDeltaPage.class)))
        .thenReturn(new GraphDeltaPage(List.of(message("G1", "제목")), null, "D1"));
    when(graphApiClient.get(eq("FAKE_TOKEN"), eq("D1"), eq(GraphDeltaPage.class)))
        .thenReturn(
            new GraphDeltaPage(
                List.of(message("G1", "제목", "sender@example.com", false)), null, "D2"));
    when(graphApiClient.get(eq("FAKE_TOKEN"), eq("D2"), eq(GraphDeltaPage.class)))
        .thenReturn(
            new GraphDeltaPage(
                List.of(message("G1", "제목", "sender@example.com", false)), null, "D3"));

    graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));
    long g1 = messageRepo.findByProviderId(accountId, "G1").orElseThrow();
    messageRepo.markSeen(g1); // 로컬 열람 — seen=true + 서버 반영 대기

    MailSyncResult pending =
        graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));
    assertThat(pending.seenChanged()).isZero();
    assertThat(snapshot(g1).value1()).isTrue();

    messageRepo.clearSeenPushPendingIf(g1, true); // 서버 반영 완료
    MailSyncResult released =
        graphMailFetcher.fetchNewMessages(userId, accountId, accountOf(accountId));
    assertThat(released.seenChanged()).isEqualTo(1);
    assertThat(snapshot(g1).value1()).isFalse();
  }
}
