package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.SendResult;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailComposeService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import jakarta.mail.internet.MimeMessage;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/** MailComposeService 통합 — 발송 성공 시 로컬 SENT 행 저장, 답장 스레드 상속, 검증/소유 격리. */
@Transactional
class MailComposeServiceTest extends IntegrationTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(ServerSetupTest.SMTP_IMAP)
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
            3143,
            MailSecurity.NONE,
            "me@test.local",
            "127.0.0.1",
            3025,
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
}
