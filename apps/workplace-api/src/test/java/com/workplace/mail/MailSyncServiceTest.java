package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.user.GreenMailUser;
import com.icegreen.greenmail.util.GreenMailUtil;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailSyncService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Properties;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * MailSyncService 통합 테스트 — GreenMail(IMAP 3143)로 실제 INBOX 를 채우고 증분 동기화를 검증한다. 검증 포인트: 신규 페치/저장, 2차
 * 동기화 멱등(no-op), 스레드 그룹핑(루트 Message-ID), 멀티파트 본문+첨부 메타, 소유 격리(404).
 */
@Transactional
class MailSyncServiceTest extends IntegrationTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(ServerSetupTest.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  /** box@test.local 을 가리키는 계정을 직접 삽입(연결테스트 우회). 동기화 대상 accountId 반환. */
  private long insertAccount(long userId) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            "box@test.local",
            "테스트박스",
            "127.0.0.1",
            3143,
            MailSecurity.NONE,
            "box@test.local",
            "127.0.0.1",
            3025,
            MailSecurity.NONE,
            "box@test.local",
            "pw");
    return accountRepo.insert(userId, req, encryption.encrypt("pw"));
  }

  @Test
  void sync_fetchesAndSavesNewMessages() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    GreenMailUtil.sendTextEmailTest("box@test.local", "alice@example.com", "안녕하세요", "본문입니다");
    GreenMailUtil.sendTextEmailTest("box@test.local", "bob@example.com", "두번째", "두번째 본문");
    greenMail.waitForIncomingEmail(2);

    MailSyncResult result = syncService.sync(user, accountId);

    assertThat(result.fetched()).isEqualTo(2);
    assertThat(result.saved()).isEqualTo(2);
    List<EmailMessageSummary> list = messageRepo.listByAccount(accountId, null, 50);
    assertThat(list).hasSize(2);
    assertThat(list).extracting(EmailMessageSummary::subject).contains("안녕하세요", "두번째");
    assertThat(list).allSatisfy(m -> assertThat(m.fromAddress()).isNotBlank());
  }

  @Test
  void sync_secondRunIsNoOp() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    GreenMailUtil.sendTextEmailTest("box@test.local", "alice@example.com", "한건", "본문");
    greenMail.waitForIncomingEmail(1);

    MailSyncResult first = syncService.sync(user, accountId);
    MailSyncResult second = syncService.sync(user, accountId);

    assertThat(first.saved()).isEqualTo(1);
    // 새 메일이 없으면 LASTUID 클램핑으로 끌려온 마지막 1건도 커서로 걸러져 저장 0
    assertThat(second.fetched()).isZero();
    assertThat(second.saved()).isZero();
    assertThat(messageRepo.listByAccount(accountId, null, 50)).hasSize(1);
  }

  @Test
  void sync_groupsThreadByRootMessageId() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    GreenMailUser box = greenMail.setUser("box@test.local", "box@test.local", "pw");
    box.deliver(textMessage("<root@test>", null, null, "원문", "원문 본문"));
    box.deliver(textMessage("<reply@test>", "<root@test>", "<root@test>", "Re: 원문", "답장 본문"));

    syncService.sync(user, accountId);

    List<EmailMessageSummary> list = messageRepo.listByAccount(accountId, null, 50);
    assertThat(list).hasSize(2);
    assertThat(list).extracting(EmailMessageSummary::threadId).containsOnly("root@test");
  }

  @Test
  void sync_capturesMultipartBodyAndAttachmentMeta() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    GreenMailUser box = greenMail.setUser("box@test.local", "box@test.local", "pw");
    box.deliver(multipartWithAttachment());

    syncService.sync(user, accountId);

    EmailMessageSummary summary = messageRepo.listByAccount(accountId, null, 50).get(0);
    assertThat(summary.hasAttachment()).isTrue();
    EmailMessageDetail detail = messageRepo.findDetailByIdAndUser(user, summary.id()).orElseThrow();
    assertThat(detail.bodyText()).contains("멀티파트 본문");
    assertThat(detail.attachments()).hasSize(1);
    assertThat(detail.attachments().get(0).filename()).isEqualTo("doc.txt");
  }

  @Test
  void sync_skipsUnparseableMessageAndKeepsGoing() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    GreenMailUser box = greenMail.setUser("box@test.local", "box@test.local", "pw");
    box.deliver(textMessage("<good@test>", null, null, "정상 메일", "정상 본문"));
    // 디코딩 불가한 charset 을 선언한 메시지(원본 바이트 보존 위해 raw 로 구성).
    box.deliver(rawMessage("text/plain; charset=\"no-such-charset-xyz\"", "broken"));

    // 불량 1건이 있어도 예외 없이 정상 1건은 저장돼야 한다(영구 정지 방지).
    MailSyncResult result = syncService.sync(user, accountId);

    assertThat(result.fetched()).isEqualTo(2);
    assertThat(result.saved()).isEqualTo(1);
    List<EmailMessageSummary> list = messageRepo.listByAccount(accountId, null, 50);
    assertThat(list).extracting(EmailMessageSummary::subject).containsExactly("정상 메일");
  }

  @Test
  void sync_searchFiltersBySubjectAndSender() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(user);
    GreenMailUtil.sendTextEmailTest("box@test.local", "alice@example.com", "프로젝트 회의", "본문");
    GreenMailUtil.sendTextEmailTest("box@test.local", "bob@example.com", "점심 메뉴", "본문");
    greenMail.waitForIncomingEmail(2);
    syncService.sync(user, accountId);

    assertThat(messageRepo.listByAccount(accountId, "회의", 50)).hasSize(1);
    assertThat(messageRepo.listByAccount(accountId, "alice", 50)).hasSize(1);
    assertThat(messageRepo.listByAccount(accountId, "없는검색어", 50)).isEmpty();
  }

  @Test
  void sync_otherUserAccount_throwsNotFound() {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long accountId = insertAccount(owner);

    assertThatThrownBy(() -> syncService.sync(other, accountId))
        .isInstanceOf(EmailAccountNotFoundException.class);
  }

  /**
   * Message-ID/In-Reply-To/References 를 제어한 단순 텍스트 메시지. saveChanges 가 Message-ID 를 덮어쓰지 않도록 보존한다.
   */
  private MimeMessage textMessage(
      String messageId, String inReplyTo, String references, String subject, String body)
      throws MessagingException {
    MimeMessage msg =
        new MimeMessage(session()) {
          @Override
          protected void updateMessageID() throws MessagingException {
            if (getHeader("Message-ID") == null) {
              super.updateMessageID();
            }
          }
        };
    msg.setFrom(new InternetAddress("sender@example.com"));
    msg.setRecipient(Message.RecipientType.TO, new InternetAddress("box@test.local"));
    msg.setSubject(subject);
    msg.setText(body, "utf-8");
    msg.setHeader("Message-ID", messageId);
    if (inReplyTo != null) {
      msg.setHeader("In-Reply-To", inReplyTo);
    }
    if (references != null) {
      msg.setHeader("References", references);
    }
    msg.saveChanges();
    return msg;
  }

  /** 원본 RFC822 바이트로 구성한 메시지(헤더를 그대로 보존 — 깨진 charset 등 비정상 케이스 재현용). */
  private MimeMessage rawMessage(String contentType, String body) throws MessagingException {
    String raw =
        "From: sender@example.com\r\n"
            + "To: box@test.local\r\n"
            + "Subject: raw\r\n"
            + "Content-Type: "
            + contentType
            + "\r\n\r\n"
            + body;
    return new MimeMessage(
        session(), new ByteArrayInputStream(raw.getBytes(StandardCharsets.US_ASCII)));
  }

  /** text/plain 본문 + 파일 첨부를 가진 multipart/mixed 메시지. */
  private MimeMessage multipartWithAttachment() throws MessagingException {
    MimeMessage msg = new MimeMessage(session());
    msg.setFrom(new InternetAddress("sender@example.com"));
    msg.setRecipient(Message.RecipientType.TO, new InternetAddress("box@test.local"));
    msg.setSubject("첨부 메일");

    MimeBodyPart text = new MimeBodyPart();
    text.setText("멀티파트 본문", "utf-8");
    MimeBodyPart attachment = new MimeBodyPart();
    attachment.setText("file contents", "utf-8");
    attachment.setFileName("doc.txt");
    attachment.setDisposition(Part.ATTACHMENT);

    MimeMultipart mp = new MimeMultipart();
    mp.addBodyPart(text);
    mp.addBodyPart(attachment);
    msg.setContent(mp);
    msg.saveChanges();
    return msg;
  }

  private Session session() {
    return Session.getInstance(new Properties());
  }
}
