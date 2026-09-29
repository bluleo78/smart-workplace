package com.workplace.mail;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.GraphBodyLoader;
import com.workplace.mail.service.GraphBodyLoader.GraphAttachmentItem;
import com.workplace.mail.service.GraphBodyLoader.GraphAttachmentList;
import com.workplace.mail.service.GraphBodyLoader.GraphMessageBody;
import com.workplace.mail.service.GraphBodyLoader.ItemBody;
import com.workplace.mail.service.GraphInlineContentIdResolver.GraphAttachmentContentId;
import com.workplace.mail.service.MailInlineContentIdBackfiller;
import com.workplace.mail.service.MailMessageService;
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
  @Autowired EmailContentRepository contentRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EncryptionService encryption;
  @Autowired EmailAttachmentRepository attachmentRepo;
  @Autowired ContentAttachmentRepository contentAttachmentRepo;
  @Autowired MailMessageService messageService;
  @Autowired MailInlineContentIdBackfiller backfiller;

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
   * Graph 메시지 GET 응답의 body(html)·bodyPreview 가 email_content 에 적재된다(Task5).
   *
   * <p>GraphApiClient.get 을 스텁해 Graph 응답을 모사하고, loadBody 후 email_content 직접 조회로 검증한다. Task6 이전에
   * findDetailByIdAndUser 는 email_message.body_html 을 읽으므로 사용하지 않는다.
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

    // Task5: 본문이 email_content 에 기록됐는지 확인(envelope JOIN content)
    String bodyHtmlViaContent =
        dsl.select(EMAIL_CONTENT.BODY_HTML)
            .from(EMAIL_MESSAGE)
            .join(EMAIL_CONTENT)
            .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
            .where(EMAIL_MESSAGE.ID.eq(messageId))
            .fetchOneInto(String.class);
    assertThat(bodyHtmlViaContent).contains("hi");
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

    // Task5: 본문이 email_content 에 기록됐는지 확인
    var row =
        dsl.select(EMAIL_CONTENT.BODY_TEXT, EMAIL_CONTENT.BODY_HTML)
            .from(EMAIL_MESSAGE)
            .join(EMAIL_CONTENT)
            .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
            .where(EMAIL_MESSAGE.ID.eq(messageId))
            .fetchOne();
    assertThat(row.value1()).contains("plain text body");
    assertThat(row.value2()).isNull();
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
                new GraphAttachmentItem(
                    "GRAPH-ATT-ID-1", "report.pdf", "application/pdf", 1024L, false)));
    when(graphApiClient.get(
            eq("TEST_AT"), contains("G3/attachments"), eq(GraphAttachmentList.class)))
        .thenReturn(attResp);

    BodyTarget target = messageRepo.findBodyTarget(accountId, messageId).orElseThrow();
    graphBodyLoader.loadBody(userId, target, accountOf(accountId));

    // Task5: 본문이 email_content 에 기록됐는지 확인
    String bodyHtmlViaContent =
        dsl.select(EMAIL_CONTENT.BODY_HTML)
            .from(EMAIL_MESSAGE)
            .join(EMAIL_CONTENT)
            .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
            .where(EMAIL_MESSAGE.ID.eq(messageId))
            .fetchOneInto(String.class);
    assertThat(bodyHtmlViaContent).contains("hi");

    // 첨부가 1건 삽입됐는지 확인 — 첨부는 여전히 envelope(messageId) 키로 저장
    EmailMessageDetail d = messageRepo.findDetailByIdAndUser(userId, messageId).orElseThrow();
    assertThat(d.attachments()).hasSize(1);
    assertThat(d.attachments().get(0).filename()).isEqualTo("report.pdf");
  }

  /**
   * providerMessageId 가 null 이면 no-op — body_fetched_at 이 갱신되지 않는다. contentId=0 이면 contentId 없음
   * 가드(Task5)가 먼저 적용될 수 있으나, 어느 경우든 graphApiClient 호출 없이 false 반환해야 한다.
   */
  @Test
  void loadBody_nullProviderMessageId_noOp() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId, "TEST_AT");
    // providerMessageId 없이 직접 BodyTarget 생성(contentId=0 → contentId 없음 가드 + providerMessageId=null)
    BodyTarget target = new BodyTarget(9999L, accountId, 0L, "INBOX", null, null, 0L);

    // 예외 없이 반환돼야 함
    graphBodyLoader.loadBody(userId, target, accountOf(accountId));

    // graphApiClient 는 호출되지 않아야 함
    org.mockito.Mockito.verifyNoInteractions(graphApiClient);
  }

  // ---- WP-68: 인라인 첨부 Content-ID ----

  /** 본문 cid 참조 스텁 + 첨부 목록(인라인 1 + 일반 1) 스텁. */
  private void stubInlineMessage(String pmid, String html) {
    when(graphApiClient.get(
            eq("TEST_AT"), contains(pmid + "?$select=body"), eq(GraphMessageBody.class)))
        .thenReturn(new GraphMessageBody(new ItemBody("html", html), "hi", true));
    when(graphApiClient.get(
            eq("TEST_AT"), contains(pmid + "/attachments?"), eq(GraphAttachmentList.class)))
        .thenReturn(
            new GraphAttachmentList(
                List.of(
                    new GraphAttachmentItem("ATT-INLINE", "logo.png", "image/png", 100L, true),
                    new GraphAttachmentItem("ATT-FILE", "a.pdf", "application/pdf", 100L, false))));
  }

  /** 본문이 cid: 를 참조하면 인라인 첨부만 단건 조회해 Content-ID 를 저장한다(일반 첨부는 추가 호출 없음). */
  @Test
  void loadBody_inlineAttachmentWithCidRef_storesContentId() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId, "TEST_AT");
    long messageId = seedGraphMessage(accountId, "G5");
    stubInlineMessage("G5", "<img src=\"cid:ii_abc\">");
    when(graphApiClient.get(
            eq("TEST_AT"),
            contains("G5/attachments/ATT-INLINE"),
            eq(GraphAttachmentContentId.class)))
        .thenReturn(new GraphAttachmentContentId("<ii_abc>"));

    BodyTarget target = messageRepo.findBodyTarget(accountId, messageId).orElseThrow();
    graphBodyLoader.loadBody(userId, target, accountOf(accountId));

    EmailMessageDetail d = messageRepo.findDetailByIdAndUser(userId, messageId).orElseThrow();
    assertThat(d.attachments()).extracting("contentId").containsExactly("ii_abc", null);
    verify(graphApiClient, never())
        .get(eq("TEST_AT"), contains("attachments/ATT-FILE"), eq(GraphAttachmentContentId.class));
  }

  /** 본문에 cid 참조가 없으면 인라인 첨부라도 단건 조회하지 않는다(서명 로고마다 Graph 호출 방지). */
  @Test
  void loadBody_noCidRef_skipsContentIdLookup() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId, "TEST_AT");
    long messageId = seedGraphMessage(accountId, "G6");
    stubInlineMessage("G6", "<p>no images</p>");

    BodyTarget target = messageRepo.findBodyTarget(accountId, messageId).orElseThrow();
    graphBodyLoader.loadBody(userId, target, accountOf(accountId));

    verify(graphApiClient, never())
        .get(anyString(), anyString(), eq(GraphAttachmentContentId.class));
    EmailMessageDetail d = messageRepo.findDetailByIdAndUser(userId, messageId).orElseThrow();
    assertThat(d.attachments()).hasSize(2);
  }

  /** 단건 조회 실패는 해당 항목만 Content-ID 없이 저장 — 이후 첨부 적재는 계속된다. */
  @Test
  void loadBody_contentIdLookupFails_otherAttachmentsStillStored() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId, "TEST_AT");
    long messageId = seedGraphMessage(accountId, "G7");
    stubInlineMessage("G7", "<img src=\"cid:x\">");
    when(graphApiClient.get(
            eq("TEST_AT"),
            contains("G7/attachments/ATT-INLINE"),
            eq(GraphAttachmentContentId.class)))
        .thenThrow(new RuntimeException("graph 503"));

    BodyTarget target = messageRepo.findBodyTarget(accountId, messageId).orElseThrow();
    graphBodyLoader.loadBody(userId, target, accountOf(accountId));

    EmailMessageDetail d = messageRepo.findDetailByIdAndUser(userId, messageId).orElseThrow();
    assertThat(d.attachments()).extracting("filename").containsExactly("logo.png", "a.pdf");
    assertThat(d.attachments()).extracting("contentId").containsOnlyNulls();
  }

  // ---- WP-68: 규칙 도입 전 적재분 지연 백필 ----

  /** 규칙 도입 전 적재 상태 재현 — 이미지 첨부 2건(Content-ID 없음) + 일반 첨부 1건. */
  private long seedLegacyInlineMessage(long accountId, String pmid) {
    long messageId = seedGraphMessage(accountId, pmid);
    long contentId = messageRepo.findBodyTarget(accountId, messageId).orElseThrow().contentId();
    attachmentRepo.insert(
        messageId, contentId, 0, new ParsedAttachment("a.png", "image/png", 10L, null, "ATT-A"));
    attachmentRepo.insert(
        messageId, contentId, 1, new ParsedAttachment("b.png", "image/png", 10L, null, "ATT-B"));
    attachmentRepo.insert(
        messageId,
        contentId,
        2,
        new ParsedAttachment("c.pdf", "application/pdf", 10L, null, "ATT-C"));
    return messageId;
  }

  /** 백필은 이미지 첨부만 단건 조회해 Content-ID 를 채우고, 값이 없으면 빈 문자열로 "확인 완료"를 기록해 재조회를 막는다. 일반 첨부는 조회하지 않는다. */
  @Test
  void backfill_fillsContentIdForLegacyImageAttachments() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId, "TEST_AT");
    long messageId = seedLegacyInlineMessage(accountId, "G8");
    when(graphApiClient.get(
            eq("TEST_AT"), contains("G8/attachments/ATT-A"), eq(GraphAttachmentContentId.class)))
        .thenReturn(new GraphAttachmentContentId("<ii_opaque>"));
    when(graphApiClient.get(
            eq("TEST_AT"), contains("G8/attachments/ATT-B"), eq(GraphAttachmentContentId.class)))
        .thenReturn(new GraphAttachmentContentId(null));

    backfiller.backfillNow(userId, messageId);

    EmailMessageDetail d = messageRepo.findDetailByIdAndUser(userId, messageId).orElseThrow();
    // ATT-B 는 "확인했지만 없음" 표시("")로 기록되지만 API 로는 null 로만 노출된다
    assertThat(d.attachments()).extracting("contentId").containsExactly("ii_opaque", null, null);
    verify(graphApiClient, never())
        .get(anyString(), contains("attachments/ATT-C"), eq(GraphAttachmentContentId.class));

    // 두 번째 호출은 후보가 없어 Graph 를 다시 부르지 않는다
    clearInvocations(graphApiClient);
    backfiller.backfillNow(userId, messageId);
    verify(graphApiClient, never())
        .get(anyString(), anyString(), eq(GraphAttachmentContentId.class));
  }

  /** 타인 소유 메시지는 백필 대상이 아니다(소유 검증). */
  @Test
  void backfill_otherUsersMessage_noOp() {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(owner, "TEST_AT");
    long messageId = seedLegacyInlineMessage(accountId, "G9");

    backfiller.backfillNow(other, messageId);

    verify(graphApiClient, never())
        .get(anyString(), anyString(), eq(GraphAttachmentContentId.class));
  }

  /** find-or-create 로 공유 행이 재사용돼도 이후 적재에서 알아낸 Content-ID 가 비어 있던 행에 채워진다. */
  @Test
  void attachmentInsert_existingSharedRowWithoutContentId_getsFilled() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId, "TEST_AT");
    long messageId = seedGraphMessage(accountId, "G10");
    long contentId = messageRepo.findBodyTarget(accountId, messageId).orElseThrow().contentId();
    attachmentRepo.insert(
        messageId, contentId, 0, new ParsedAttachment("a.png", "image/png", 10L, null, "ATT-A"));

    // 같은 content 의 같은 ordinal 을 Content-ID 와 함께 다시 적재(다른 envelope/재적재 상황)
    attachmentRepo.insert(
        messageId, contentId, 0, new ParsedAttachment("a.png", "image/png", 10L, "ii_1", "ATT-A"));
    // 이미 값이 있으면 덮어쓰지 않는다
    attachmentRepo.insert(
        messageId, contentId, 0, new ParsedAttachment("a.png", "image/png", 10L, "ii_2", "ATT-A"));

    String stored =
        dsl.select(CONTENT_ATTACHMENT.MIME_CONTENT_ID)
            .from(CONTENT_ATTACHMENT)
            .where(CONTENT_ATTACHMENT.CONTENT_ID.eq(contentId))
            .and(CONTENT_ATTACHMENT.ORDINAL.eq(0))
            .fetchOneInto(String.class);
    assertThat(stored).isEqualTo("ii_1");
  }

  /**
   * 규칙 도입 전 적재된 인라인 전용 Graph 메일(첨부 행 0) — 열람 시 첨부 목록을 즉시 적재해 같은 응답에서 cid 매칭이 가능해야 한다. 두 번째 열람은 행이
   * 있으므로 Graph 목록을 다시 부르지 않는다(중복 적재 없음).
   */
  @Test
  void get_legacyInlineOnlyMessage_loadsAttachmentsOnOpen_once() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId, "TEST_AT");
    long messageId = seedGraphMessage(accountId, "G14");
    long contentId = messageRepo.findBodyTarget(accountId, messageId).orElseThrow().contentId();
    // 레거시 상태: 본문은 적재됐고(cid 참조) 첨부 행은 없음
    contentRepo.updateBody(contentId, null, "<p>hi</p><img src=\"cid:ii_z\">", "hi");
    messageRepo.markFetched(messageId);
    when(graphApiClient.get(
            eq("TEST_AT"), contains("G14/attachments?"), eq(GraphAttachmentList.class)))
        .thenReturn(
            new GraphAttachmentList(
                List.of(new GraphAttachmentItem("ATT-Z", "z.png", "image/png", 50L, true))));
    when(graphApiClient.get(
            eq("TEST_AT"), contains("G14/attachments/ATT-Z"), eq(GraphAttachmentContentId.class)))
        .thenReturn(new GraphAttachmentContentId("<ii_z>"));

    EmailMessageDetail d = messageService.get(userId, messageId);

    assertThat(d.attachments()).extracting("contentId").containsExactly("ii_z");

    clearInvocations(graphApiClient);
    assertThat(messageService.get(userId, messageId).attachments()).hasSize(1);
    verify(graphApiClient, never())
        .get(anyString(), contains("G14/attachments?"), eq(GraphAttachmentList.class));
  }

  /** 백필의 "확인했지만 없음" 표시("")는 나중에 알게 된 실제 Content-ID 로 덮어써진다(표시값끼리는 덮어쓰지 않음). */
  @Test
  void setMimeContentIdIfNull_realValueReplacesCheckedMarker() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId, "TEST_AT");
    long messageId = seedGraphMessage(accountId, "G13");
    long contentId = messageRepo.findBodyTarget(accountId, messageId).orElseThrow().contentId();
    attachmentRepo.insert(
        messageId, contentId, 0, new ParsedAttachment("a.png", "image/png", 10L, null, "ATT-A"));
    long caId =
        dsl.select(CONTENT_ATTACHMENT.ID)
            .from(CONTENT_ATTACHMENT)
            .where(CONTENT_ATTACHMENT.CONTENT_ID.eq(contentId))
            .fetchOne(CONTENT_ATTACHMENT.ID);

    contentAttachmentRepo.setMimeContentIdIfNull(caId, "");
    contentAttachmentRepo.setMimeContentIdIfNull(caId, "ii_real");
    contentAttachmentRepo.setMimeContentIdIfNull(caId, "");

    assertThat(
            dsl.select(CONTENT_ATTACHMENT.MIME_CONTENT_ID)
                .from(CONTENT_ATTACHMENT)
                .where(CONTENT_ATTACHMENT.ID.eq(caId))
                .fetchOneInto(String.class))
        .isEqualTo("ii_real");
  }

  /**
   * Graph hasAttachments 는 인라인 첨부를 세지 않는다 — 인라인 이미지만 있는 메일(hasAttachments=false)도 본문이 cid: 를 참조하면
   * 첨부 목록을 적재해야 프론트가 이미지를 매칭할 수 있다.
   */
  @Test
  void loadBody_inlineOnlyMessage_hasAttachmentsFalse_stillLoadsAttachments() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId, "TEST_AT");
    long messageId = seedGraphMessage(accountId, "G11");
    when(graphApiClient.get(
            eq("TEST_AT"), contains("G11?$select=body"), eq(GraphMessageBody.class)))
        .thenReturn(
            new GraphMessageBody(new ItemBody("html", "<img src=\"cid:ii_q\">"), "hi", false));
    when(graphApiClient.get(
            eq("TEST_AT"), contains("G11/attachments?"), eq(GraphAttachmentList.class)))
        .thenReturn(
            new GraphAttachmentList(
                List.of(new GraphAttachmentItem("ATT-Q", "shot.png", "image/png", 50L, true))));
    when(graphApiClient.get(
            eq("TEST_AT"), contains("G11/attachments/ATT-Q"), eq(GraphAttachmentContentId.class)))
        .thenReturn(new GraphAttachmentContentId("<ii_q>"));

    BodyTarget target = messageRepo.findBodyTarget(accountId, messageId).orElseThrow();
    graphBodyLoader.loadBody(userId, target, accountOf(accountId));

    EmailMessageDetail d = messageRepo.findDetailByIdAndUser(userId, messageId).orElseThrow();
    assertThat(d.attachments()).extracting("contentId").containsExactly("ii_q");
  }

  /** 백필 중 Graph 일시 장애는 "없음"으로 기록하지 않는다 — NULL 로 남아 다음 열람에 다시 조회된다. */
  @Test
  void backfill_transientFailure_leavesNullForRetry() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = seedGraphAccount(userId, "TEST_AT");
    long messageId = seedLegacyInlineMessage(accountId, "G12");
    when(graphApiClient.get(
            anyString(), contains("G12/attachments/"), eq(GraphAttachmentContentId.class)))
        .thenThrow(new RuntimeException("429 throttled"));

    backfiller.backfillNow(userId, messageId);

    EmailMessageDetail d = messageRepo.findDetailByIdAndUser(userId, messageId).orElseThrow();
    assertThat(d.attachments()).extracting("contentId").containsOnlyNulls();

    // 장애 회복 후 재열람 — 이번엔 채워진다
    org.mockito.Mockito.reset(graphApiClient);
    when(graphApiClient.get(
            anyString(), contains("G12/attachments/ATT-A"), eq(GraphAttachmentContentId.class)))
        .thenReturn(new GraphAttachmentContentId("<ii_a>"));
    when(graphApiClient.get(
            anyString(), contains("G12/attachments/ATT-B"), eq(GraphAttachmentContentId.class)))
        .thenReturn(new GraphAttachmentContentId("<ii_b>"));
    backfiller.backfillNow(userId, messageId);

    d = messageRepo.findDetailByIdAndUser(userId, messageId).orElseThrow();
    assertThat(d.attachments()).extracting("contentId").containsExactly("ii_a", "ii_b", null);
  }
}
