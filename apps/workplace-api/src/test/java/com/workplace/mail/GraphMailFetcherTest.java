package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
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

  /** 헬퍼: 신규(삭제 아님) GraphMessage 생성. */
  private GraphMessage message(String id, String subject) {
    Recipient from = new Recipient(new EmailAddress("sender@example.com", "보낸사람"));
    return new GraphMessage(
        id,
        subject,
        from,
        List.of(new Recipient(new EmailAddress("to@example.com", "받는사람"))),
        List.of(),
        "2024-01-01T10:00:00Z",
        "2024-01-01T09:55:00Z",
        false,
        false,
        "<msg-" + id + "@example.com>",
        "conv-" + id,
        null /* @removed 없음 */);
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
}
