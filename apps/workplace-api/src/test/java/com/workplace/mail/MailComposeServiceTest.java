package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.MailSendRequest.InlineImageRef;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.dto.SendResult;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailAttachmentService.GraphAttachment;
import com.workplace.mail.service.MailComposeService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Properties;
import java.util.stream.IntStream;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/** MailComposeService 통합 — 발송 성공 시 로컬 SENT 행 저장, 답장 스레드 상속, 검증/소유 격리. */
@Transactional
class MailComposeServiceTest extends IntegrationTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(MailTestPorts.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("me@test.local", "me@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailComposeService composeService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  // Graph 발송 경로 검증용 Mockito 빈 — SMTP 경로는 실제 GreenMail 서버를 사용한다.
  @MockitoBean GraphApiClient graphApiClient;
  @MockitoBean GraphTokenService graphTokenService;

  private long account(long user) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            "me@test.local",
            "나",
            "127.0.0.1",
            MailTestPorts.IMAP,
            MailSecurity.NONE,
            "me@test.local",
            "127.0.0.1",
            MailTestPorts.SMTP,
            MailSecurity.NONE,
            "me@test.local",
            "pw",
            false);
    return accountRepo.insert(user, req, encryption.encrypt("pw"));
  }

  @Test
  void send_deliversAndStoresLocalSentRow() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = account(user);
    MailSendRequest req =
        new MailSendRequest(
            List.of("rcpt@test.local"), List.of(), List.of(), "안녕", "<p>본문</p>", "본문", null);

    SendResult result = composeService.send(user, accountId, req);

    assertThat(result.localMessageId()).isPositive();
    assertThat(result.messageId()).contains("@test.local");
    assertThat(greenMail.getReceivedMessages()).hasSize(1);
    List<EmailMessageSummary> sent = messageRepo.listByAccount(accountId, "SENT", null, 50);
    assertThat(sent).extracting(EmailMessageSummary::subject).containsExactly("안녕");
  }

  @Test
  void send_replyInheritsParentThreadId() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = account(user);
    // 부모(보낸) 행을 직접 저장해 thread_id 를 고정.
    long folderId = folderRepo.ensureFolder(accountId, "SENT").id();
    OutgoingMail parent =
        new OutgoingMail(
            "parent@test.local",
            "thread-xyz",
            "me@test.local",
            "나",
            List.of("rcpt@test.local"),
            List.of(),
            List.of(),
            "원문",
            "원문본문",
            "<p>원문본문</p>",
            null,
            null,
            "원문본문",
            Instant.now());
    long parentId = messageRepo.insertSent(accountId, folderId, parent);

    MailSendRequest reply =
        new MailSendRequest(
            List.of("rcpt@test.local"),
            List.of(),
            List.of(),
            "Re: 원문",
            "<p>답장</p>",
            "답장",
            parentId);
    SendResult result = composeService.send(user, accountId, reply);

    // 답장의 로컬 행 thread_id 가 부모와 동일 → 대화 묶임.
    List<EmailMessageSummary> sent = messageRepo.listByAccount(accountId, "SENT", null, 50);
    assertThat(sent)
        .filteredOn(m -> m.id() == result.localMessageId())
        .extracting(EmailMessageSummary::threadId)
        .containsExactly("thread-xyz");
    // 전송본에 In-Reply-To 설정.
    MimeMessage[] received = greenMail.getReceivedMessages();
    assertThat(received).isNotEmpty();
    assertThat(received[0].getHeader("In-Reply-To")[0]).isEqualTo("<parent@test.local>");
  }

  @Test
  void send_replyToNullMessageIdParent_noMalformedHeader() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = account(user);
    long folderId = folderRepo.ensureFolder(accountId, "SENT").id();
    OutgoingMail parent =
        new OutgoingMail(
            null,
            "thread-null",
            "me@test.local",
            "나",
            List.of("rcpt@test.local"),
            List.of(),
            List.of(),
            "원문",
            "본문",
            "<p>본문</p>",
            null,
            null,
            "본문",
            Instant.now());
    long parentId = messageRepo.insertSent(accountId, folderId, parent);

    MailSendRequest reply =
        new MailSendRequest(
            List.of("rcpt@test.local"),
            List.of(),
            List.of(),
            "Re: 원문",
            "<p>답장</p>",
            "답장",
            parentId);
    composeService.send(user, accountId, reply); // 예외 없이 발송돼야 함

    MimeMessage m = greenMail.getReceivedMessages()[0];
    // 부모 Message-ID 가 없으면 References 헤더가 아예 없어야 한다(리터럴 "<null>" 금지).
    assertThat(m.getHeader("References")).isNull();
  }

  @Test
  void send_noRecipients_throwsValidation() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = account(user);
    MailSendRequest req =
        new MailSendRequest(List.of(), List.of(), List.of(), "제목", "<p>x</p>", "x", null);

    assertThatThrownBy(() -> composeService.send(user, accountId, req))
        .isInstanceOf(MailValidationException.class);
  }

  @Test
  void send_otherUserAccount_throwsNotFound() {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long accountId = account(owner);
    MailSendRequest req =
        new MailSendRequest(
            List.of("rcpt@test.local"), List.of(), List.of(), "x", "<p>x</p>", "x", null);

    assertThatThrownBy(() -> composeService.send(other, accountId, req))
        .isInstanceOf(EmailAccountNotFoundException.class);
  }

  /**
   * Graph(M365_GRAPH) 계정으로 발송하면 GraphApiClient.sendMail 을 호출하고 로컬 SENT 행을 저장한다. IMAP APPEND 는 수행하지
   * 않는다(Graph 는 saveToSentItems 로 서버가 자동 보관).
   */
  @Test
  void send_graphAccount_usesSendMailAndStoresLocalSentRow() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    // GraphTokenService 스텁: 토큰 반환
    when(graphTokenService.getAccessToken(user, accountId)).thenReturn("FAKE_TOKEN");

    SendResult res =
        composeService.send(
            user,
            accountId,
            new MailSendRequest(
                List.of("peer@example.com"), null, null, "제목", "<p>본문</p>", "본문", null));

    // Graph sendMail API 가 호출됐는지 검증(FAKE_TOKEN 과 base64 MIME 을 인수로).
    verify(graphApiClient).sendMail(eq("FAKE_TOKEN"), any());
    // 로컬 SENT 행이 저장됐는지 확인.
    assertThat(res.localMessageId()).isPositive();
    List<EmailMessageSummary> sent = messageRepo.listByAccount(accountId, "SENT", null, 50);
    assertThat(sent).hasSize(1);
    assertThat(sent.get(0).subject()).isEqualTo("제목");
  }

  /**
   * SMTP(IMAP 계정) 경로에서 Bcc 봉투 팬아웃 및 Bcc 헤더 노출 없음 검증.
   *
   * <ul>
   *   <li>to·cc·bcc 각 1명 — SMTP 봉투에는 3명 모두 포함 → GreenMail 수신 3건.
   *   <li>수신된 어떤 MIME 사본에도 Bcc 헤더가 없어야 한다(프라이버시 보호).
   * </ul>
   */
  @Test
  void send_smtp_bccFanOutAndNoLeakInHeader() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = account(user);
    MailSendRequest req =
        new MailSendRequest(
            List.of("to@test.local"),
            List.of("cc@test.local"),
            List.of("bcc@test.local"),
            "Bcc 검증",
            "<p>본문</p>",
            "본문",
            null);

    composeService.send(user, accountId, req);

    // SMTP 봉투 팬아웃: To + Cc + Bcc = 3건 수신.
    MimeMessage[] received = greenMail.getReceivedMessages();
    assertThat(received).hasSize(3);
    // 수신된 어떤 사본에도 Bcc 헤더가 노출되지 않아야 한다.
    assertThat(received).allSatisfy(copy -> assertThat(copy.getHeader("Bcc")).isNull());
  }

  /**
   * Graph 계정 경로에서 Bcc 가 MIME 에 포함되어 Graph API 로 전달되는지 검증.
   *
   * <p>Graph 는 raw MIME 의 Bcc 헤더를 파싱해 블라인드 발송하고 전달본에서 제거한다. SmtpMailTransport 는 봉투(envelope)로 처리하므로
   * 공유 MailMimeBuilder 에는 Bcc 를 넣지 않고, GraphMailTransport 에서만 주입한다.
   */
  @Test
  void send_graphAccount_bccInjectedInMimeForGraph() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    when(graphTokenService.getAccessToken(user, accountId)).thenReturn("FAKE_TOKEN");

    // Bcc 를 포함한 발송 요청.
    org.mockito.ArgumentCaptor<String> base64Captor =
        org.mockito.ArgumentCaptor.forClass(String.class);

    composeService.send(
        user,
        accountId,
        new MailSendRequest(
            List.of("to@example.com"),
            List.of(),
            List.of("secret-bcc@example.com"),
            "Graph Bcc 검증",
            "<p>본문</p>",
            "본문",
            null));

    // GraphApiClient.sendMail 에 전달된 base64 MIME 을 캡처하고 디코딩해 Bcc 헤더가 포함됐는지 검증.
    verify(graphApiClient).sendMail(eq("FAKE_TOKEN"), base64Captor.capture());
    String decodedMime =
        new String(Base64.getDecoder().decode(base64Captor.getValue()), StandardCharsets.UTF_8);
    assertThat(decodedMime).contains("Bcc:");
    assertThat(decodedMime).contains("secret-bcc@example.com");
  }

  // ---- WP-69: 답장·전달 인용문 인라인 이미지 재첨부 ----

  @Autowired EmailAttachmentRepository attachmentRepo;

  private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 1, 2, 3};

  /** Graph 원본 메일 + 첨부 1건 시드. 첨부 바이트는 Graph 단건 조회 스텁으로 제공한다. @return email_attachment.id */
  private long seedSourceAttachment(
      long accountId, String pmid, String filename, String contentType, long size) {
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    ParsedMessage m =
        new ParsedMessage(
            0L,
            "src-" + pmid + "@x",
            "t-" + pmid,
            null,
            null,
            "a@x.com",
            "A",
            "me@x.com",
            null,
            "원본",
            Instant.now(),
            Instant.now(),
            true,
            true,
            null,
            null,
            null,
            List.of());
    messageRepo.upsertByProviderId(accountId, folderId, m, pmid);
    long messageId = messageRepo.findByProviderId(accountId, pmid).orElseThrow();
    long contentId = messageRepo.findBodyTarget(accountId, messageId).orElseThrow().contentId();
    attachmentRepo.insert(
        messageId,
        contentId,
        0,
        new ParsedAttachment(filename, contentType, size, null, "ATT-" + pmid));
    when(graphApiClient.get(
            any(), contains(pmid + "/attachments/ATT-" + pmid), eq(GraphAttachment.class)))
        .thenReturn(
            new GraphAttachment(filename, contentType, Base64.getEncoder().encodeToString(PNG)));
    return dsl.select(EMAIL_ATTACHMENT.ID)
        .from(EMAIL_ATTACHMENT)
        .where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(messageId))
        .fetchOne(EMAIL_ATTACHMENT.ID);
  }

  private MailSendRequest replyWithInline(List<InlineImageRef> refs) {
    return new MailSendRequest(
        List.of("peer@example.com"),
        List.of(),
        List.of(),
        "RE: 원본",
        "<p>답장</p><blockquote><img src=\"cid:7dc8.png\"></blockquote>",
        "답장",
        null,
        refs);
  }

  /**
   * 인용문 인라인 이미지는 원본 첨부 바이트를 가져와 같은 Content-ID 의 인라인 파트로 붙는다 — multipart/related(alternative + 이미지).
   * text/html 본문도 유지된다.
   */
  @Test
  void send_withInlineImages_reattachesAsRelatedInlinePart() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    when(graphTokenService.getAccessToken(eq(user), eq(accountId))).thenReturn("FAKE_TOKEN");
    long attId = seedSourceAttachment(accountId, "S1", "7dc8.png", "image/png", PNG.length);

    composeService.send(
        user, accountId, replyWithInline(List.of(new InlineImageRef(attId, "7dc8.png"))));

    ArgumentCaptor<String> cap = ArgumentCaptor.forClass(String.class);
    verify(graphApiClient).sendMail(eq("FAKE_TOKEN"), cap.capture());
    MimeMessage sent =
        new MimeMessage(
            Session.getInstance(new Properties()),
            new ByteArrayInputStream(Base64.getDecoder().decode(cap.getValue())));
    assertThat(sent.isMimeType("multipart/related")).isTrue();
    MimeMultipart related = (MimeMultipart) sent.getContent();
    assertThat(related.getCount()).isEqualTo(2);
    assertThat(related.getBodyPart(0).isMimeType("multipart/alternative")).isTrue();
    MimeMultipart alt = (MimeMultipart) related.getBodyPart(0).getContent();
    assertThat(alt.getBodyPart(0).isMimeType("text/plain")).isTrue();
    assertThat((String) alt.getBodyPart(1).getContent()).contains("cid:7dc8.png");
    MimeBodyPart img = (MimeBodyPart) related.getBodyPart(1);
    assertThat(img.getContentID()).isEqualTo("<7dc8.png>");
    assertThat(img.getDisposition()).isEqualTo(Part.INLINE);
    assertThat(img.isMimeType("image/png")).isTrue();
    assertThat(img.getInputStream().readAllBytes()).isEqualTo(PNG);
  }

  /** 인라인 이미지 없으면 기존처럼 multipart/alternative 만 조립한다(회귀). */
  @Test
  void send_withoutInlineImages_keepsAlternativeOnly() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    when(graphTokenService.getAccessToken(eq(user), eq(accountId))).thenReturn("FAKE_TOKEN");

    composeService.send(user, accountId, replyWithInline(null));

    ArgumentCaptor<String> cap = ArgumentCaptor.forClass(String.class);
    verify(graphApiClient).sendMail(eq("FAKE_TOKEN"), cap.capture());
    String mime = new String(Base64.getDecoder().decode(cap.getValue()), StandardCharsets.UTF_8);
    assertThat(mime).contains("multipart/alternative").doesNotContain("multipart/related");
  }

  /** 타인 소유 첨부는 인라인 원본으로 쓸 수 없다 — 사전검증에서 차단(바이트 조회·발송 없음). */
  @Test
  void validateSendable_inlineImageOfOtherUser_rejected() {
    long owner = TestFixtures.createHuman(dsl);
    long attacker = TestFixtures.createHuman(dsl);
    long ownerAccount = MailTestSupport.seedGraphAccount(dsl, encryption, owner);
    long attackerAccount = MailTestSupport.seedGraphAccount(dsl, encryption, attacker);
    long attId = seedSourceAttachment(ownerAccount, "S2", "a.png", "image/png", PNG.length);

    assertThatThrownBy(
            () ->
                composeService.validateSendable(
                    attacker,
                    attackerAccount,
                    replyWithInline(List.of(new InlineImageRef(attId, "a.png")))))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("원본을 찾을 수 없습니다");
    verify(graphApiClient, never()).sendMail(any(), any());
  }

  /** 이미지가 아닌 첨부는 인라인으로 붙이지 않는다. */
  @Test
  void validateSendable_inlineNonImage_rejected() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    long attId = seedSourceAttachment(accountId, "S3", "a.pdf", "application/pdf", 10);

    assertThatThrownBy(
            () ->
                composeService.validateSendable(
                    user, accountId, replyWithInline(List.of(new InlineImageRef(attId, "a.pdf")))))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("이미지 파일이 아닙니다");
  }

  /** Content-ID 에 공백·꺾쇠·개행·비ASCII 가 있으면 헤더 인젝션 위험 — 거부한다. */
  @Test
  void validateSendable_inlineInvalidContentId_rejected() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    long attId = seedSourceAttachment(accountId, "S4", "a.png", "image/png", 10);

    for (String bad : List.of("a b", "<a>", "a\r\nBcc: x@y", "", "한글.png")) {
      assertThatThrownBy(
              () ->
                  composeService.validateSendable(
                      user, accountId, replyWithInline(List.of(new InlineImageRef(attId, bad)))))
          .as(bad)
          .isInstanceOf(MailValidationException.class);
    }
  }

  /** Graph 는 요청 4MB 제한 — 인라인 원본 합계 2MB 초과면 사전검증에서 안내한다. */
  @Test
  void validateSendable_inlineOverGraphCap_rejected() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    long attId = seedSourceAttachment(accountId, "S5", "big.png", "image/png", 3L * 1024 * 1024);

    assertThatThrownBy(
            () ->
                composeService.validateSendable(
                    user,
                    accountId,
                    replyWithInline(List.of(new InlineImageRef(attId, "big.png")))))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("용량이 너무 큽니다");
  }

  /** 개수 상한 초과는 거부. */
  @Test
  void validateSendable_tooManyInlineImages_rejected() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    List<InlineImageRef> refs =
        IntStream.range(0, 21).mapToObj(i -> new InlineImageRef(1L, "c" + i)).toList();

    assertThatThrownBy(
            () -> composeService.validateSendable(user, accountId, replyWithInline(refs)))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("최대 20개");
  }

  /** 원본 바이트 조회 실패 시 조용히 빼지 않고 발송 전체를 실패시킨다(수신자에게 깨진 이미지 방지). */
  @Test
  void send_inlineSourceFetchFails_sendFailsWithoutTransmit() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    when(graphTokenService.getAccessToken(eq(user), eq(accountId))).thenReturn("FAKE_TOKEN");
    long attId = seedSourceAttachment(accountId, "S6", "a.png", "image/png", 10);
    when(graphApiClient.get(any(), contains("S6/attachments/ATT-S6"), eq(GraphAttachment.class)))
        .thenThrow(new RuntimeException("graph 503"));

    assertThatThrownBy(
            () ->
                composeService.send(
                    user, accountId, replyWithInline(List.of(new InlineImageRef(attId, "a.png")))))
        .isInstanceOf(MailSendException.class)
        .hasMessageContaining("인용문 이미지를 가져오지 못했습니다");
    verify(graphApiClient, never()).sendMail(any(), any());
  }
}
