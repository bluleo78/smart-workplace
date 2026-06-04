package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailComposeService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import jakarta.mail.internet.MimeMessage;
import java.time.Instant;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
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
            "pw");
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
}
