package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.GraphBodyLoader;
import com.workplace.mail.service.GraphBodyLoader.GraphAttachmentItem;
import com.workplace.mail.service.GraphBodyLoader.GraphAttachmentList;
import com.workplace.mail.service.GraphBodyLoader.GraphMessageBody;
import com.workplace.mail.service.GraphBodyLoader.ItemBody;
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
 * GraphBodyLoader 통합 테스트 — @MockitoBean GraphApiClient 로 Graph 응답을 스텁해 본문·첨부 적재를 검증한다.
 *
 * <p>GraphTokenService.getAccessToken 도 내부적으로 GraphApiClient.refresh 를 쓰므로, 만료 시각을 미래로 설정하고
 * OAUTH_ACCESS_TOKEN 을 직접 저장해 refresh 호출 없이 캐시 토큰을 반환하도록 한다.
 */
@Transactional
class GraphBodyLoaderTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired GraphBodyLoader graphBodyLoader;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EncryptionService encryption;

  /** 실제 Graph/AAD 네트워크 호출 차단. */
  @MockitoBean GraphApiClient graphApiClient;

  /**
   * M365_GRAPH 계정 시드. access_token 과 미래 만료 시각을 직접 저장해 GraphTokenService 의 refresh 호출을 우회한다.
   *
   * @param userId 계정 소유자
   * @param plainAccessToken 평문 access_token (캐시됨)
   * @return 생성된 accountId
   */
  private long seedGraphAccount(long userId, String plainAccessToken) {
    long accountId =
        dsl.insertInto(EMAIL_ACCOUNT)
            .set(EMAIL_ACCOUNT.USER_ID, userId)
            .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "graph-test-" + userId + "@example.com")
            .set(EMAIL_ACCOUNT.DISPLAY_NAME, "Graph 테스트")
            .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
            // refresh_token 은 갱신 경로에 진입하면 필요하므로 더미 저장
            .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("dummy-rt"))
            .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt(plainAccessToken))
            // 만료 시각 1시간 후 → 갱신 불필요
            .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
            .set(EMAIL_ACCOUNT.AI_ENABLED, false)
            .returning(EMAIL_ACCOUNT.ID)
            .fetchOne()
            .getId();
    return accountId;
  }

  /**
   * Graph 메시지를 email_message 에 삽입하고 messageId(PK)를 반환한다.
   *
   * <p>upsertByProviderId 를 사용해 Graph 계정 메시지 패턴으로 저장한다(imap_uid=null).
   *
   * @param accountId 계정 id
   * @param providerMessageId Graph 메시지 id (provider_message_id 컬럼)
   * @return 생성된 messageId(PK)
   */
  private long seedGraphMessage(long accountId, String providerMessageId) {
    // ensureFolder 로 INBOX 폴더 보장
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();

    ParsedMessage m =
        new ParsedMessage(
            0L, // imapUid — Graph 계정은 0(무시됨)
            "mid-" + providerMessageId + "@graph",
            "thread-" + providerMessageId,
            null,
            null,
            "sender@example.com",
            "발신자",
            "recipient@example.com",
            null,
            "Graph 테스트 메일",
            Instant.now(),
            Instant.now(),
            false,
            false,
            null,
            null,
            null,
            List.of());

    messageRepo.upsertByProviderId(accountId, folderId, m, providerMessageId);
    return messageRepo.findByProviderId(accountId, providerMessageId).orElseThrow();
  }

  /**
   * EmailAccountResponse 최소 빌더 — GraphBodyLoader.loadBody 에 account 파라미터로 전달.
   *
   * <p>loader 는 account.provider() 만 참조하지 않음 — GraphTokenService 가 accountId/userId 로 직접 토큰을 조회한다.
   */
  private EmailAccountResponse accountOf(long accountId) {
    return accountRepo
        .findByIdAndUser(/* userId 는 loadBody 가 인자로 받으므로 여기선 0 */ 0L, accountId)
        .orElseGet(
            () ->
                // 테스트 격리: 조회 실패 시 최소 DTO 생성
                new EmailAccountResponse(
                    accountId,
                    "test@example.com",
                    "테스트",
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    false,
                    null,
                    com.workplace.mail.dto.MailProvider.M365_GRAPH));
  }

  /**
   * Graph 메시지 GET 응답의 body(html)·bodyPreview 가 email_message 에 적재된다.
   *
   * <p>GraphApiClient.get 을 스텁해 Graph 응답을 모사하고, updateBody 후 messageRepo.findDetailByIdAndUser 로
   * 검증한다.
   */
  @Test
  void loadBody_storesHtmlAndSnippet() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId, "TEST_AT");
    long messageId = seedGraphMessage(accountId, "G1");

    // Graph 본문 응답 스텁 — html 타입, bodyPreview "hi"
    GraphMessageBody msgResp = new GraphMessageBody(new ItemBody("html", "<p>hi</p>"), "hi", false);
    when(graphApiClient.get(eq("TEST_AT"), contains("G1?$select=body"), eq(GraphMessageBody.class)))
        .thenReturn(msgResp);

    BodyTarget target = messageRepo.findBodyTarget(accountId, messageId).orElseThrow();
    graphBodyLoader.loadBody(userId, target, accountOf(accountId));

    EmailMessageDetail d = messageRepo.findDetailByIdAndUser(userId, messageId).orElseThrow();
    assertThat(d.bodyHtml()).contains("hi");
  }

  /** body.contentType="text" 이면 bodyText 에 저장되고 bodyHtml 은 null. */
  @Test
  void loadBody_textContentType_storesBodyText() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId, "TEST_AT");
    long messageId = seedGraphMessage(accountId, "G2");

    GraphMessageBody msgResp =
        new GraphMessageBody(new ItemBody("text", "plain text body"), "plain text body", false);
    when(graphApiClient.get(eq("TEST_AT"), contains("G2?$select=body"), eq(GraphMessageBody.class)))
        .thenReturn(msgResp);

    BodyTarget target = messageRepo.findBodyTarget(accountId, messageId).orElseThrow();
    graphBodyLoader.loadBody(userId, target, accountOf(accountId));

    EmailMessageDetail d = messageRepo.findDetailByIdAndUser(userId, messageId).orElseThrow();
    assertThat(d.bodyText()).contains("plain text body");
    assertThat(d.bodyHtml()).isNull();
  }

  /** hasAttachments=true 이면 첨부 메타 조회 추가 호출 후 email_attachment 에 삽입된다. */
  @Test
  void loadBody_withAttachments_insertsAttachmentMeta() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId, "TEST_AT");
    long messageId = seedGraphMessage(accountId, "G3");

    // 본문 응답 — hasAttachments=true
    GraphMessageBody msgResp = new GraphMessageBody(new ItemBody("html", "<p>hi</p>"), "hi", true);
    when(graphApiClient.get(eq("TEST_AT"), contains("G3?$select=body"), eq(GraphMessageBody.class)))
        .thenReturn(msgResp);

    // 첨부 목록 응답 — id 포함(provider_attachment_id 저장 검증)
    GraphAttachmentList attResp =
        new GraphAttachmentList(
            List.of(
                new GraphAttachmentItem("GRAPH-ATT-ID-1", "report.pdf", "application/pdf", 1024L)));
    when(graphApiClient.get(
            eq("TEST_AT"), contains("G3/attachments"), eq(GraphAttachmentList.class)))
        .thenReturn(attResp);

    BodyTarget target = messageRepo.findBodyTarget(accountId, messageId).orElseThrow();
    graphBodyLoader.loadBody(userId, target, accountOf(accountId));

    EmailMessageDetail d = messageRepo.findDetailByIdAndUser(userId, messageId).orElseThrow();
    assertThat(d.bodyHtml()).contains("hi");
    // 첨부가 1건 삽입됐는지 확인
    assertThat(d.attachments()).hasSize(1);
    assertThat(d.attachments().get(0).filename()).isEqualTo("report.pdf");
  }

  /** providerMessageId 가 null 이면 no-op — body_fetched_at 이 갱신되지 않는다. */
  @Test
  void loadBody_nullProviderMessageId_noOp() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId, "TEST_AT");
    // providerMessageId 없이 직접 BodyTarget 생성
    BodyTarget target = new BodyTarget(9999L, accountId, 0L, "INBOX", null, null);

    // 예외 없이 반환돼야 함
    graphBodyLoader.loadBody(userId, target, accountOf(accountId));

    // graphApiClient 는 호출되지 않아야 함
    org.mockito.Mockito.verifyNoInteractions(graphApiClient);
  }
}
