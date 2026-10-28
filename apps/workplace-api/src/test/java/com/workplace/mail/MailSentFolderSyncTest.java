package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static org.assertj.core.api.Assertions.assertThat;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.imap.ImapHostManager;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.store.MailFolder;
import com.icegreen.greenmail.user.GreenMailUser;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailSyncProgress;
import com.workplace.mail.service.MailSyncService;
import com.workplace.support.TestFixtures;
import jakarta.mail.Flags;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Properties;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 서버 보낸편지함 동기화(WP-950) 통합 테스트 — GreenMail 의 「Sent」 폴더에 외부 메일 클라이언트가 보낸 메일을 넣고, IMAP 동기화가 그것을 앱
 * 보낸편지함(SENT 보기)에 보이게 하는지 본다. 앱이 보낸 메일은 서버 보낸편지함에도 APPEND 되므로 같은 Message-ID 의 서버 사본은 가려 한 번만 보여야
 * 한다. 받은편지함(「새 메일 N건」)에는 섞이지 않는다.
 */
@Transactional
class MailSentFolderSyncTest extends MailSyncTestSupport {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(MailTestPorts.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;
  @Autowired MailSyncProgress progress;

  /** ai-agent 실호출 차단. */
  @Autowired AiAgentMailClient mailClient;

  /** GreenMail 사용자 box@test.local 의 서버 「Sent」 폴더(없으면 만든다). */
  private MailFolder serverSent() throws Exception {
    GreenMailUser box = greenMail.getUserManager().getUser("box@test.local");
    ImapHostManager imap = greenMail.getManagers().getImapHostManager();
    MailFolder existing = imap.getFolder(box, "Sent");
    return existing != null ? existing : imap.createMailbox(box, "Sent");
  }

  /** 서버 보낸편지함에 메일을 넣는다(외부 클라이언트 발송 또는 앱의 APPEND 사본을 흉내). 보낸 메일이라 \Seen. */
  private void appendSent(String messageId, String subject) throws Exception {
    MimeMessage msg =
        new MimeMessage(Session.getInstance(new Properties())) {
          @Override
          protected void updateMessageID() throws MessagingException {
            if (getHeader("Message-ID") == null) {
              super.updateMessageID();
            }
          }
        };
    msg.setFrom(new InternetAddress("box@test.local"));
    msg.setRecipient(Message.RecipientType.TO, new InternetAddress("friend@example.com"));
    msg.setSubject(subject);
    msg.setText("보낸 본문", "utf-8");
    msg.setHeader("Message-ID", messageId);
    msg.saveChanges();
    serverSent().appendMessage(msg, new Flags(Flags.Flag.SEEN), new Date());
  }

  /** 앱이 보낸 기록(로컬 SENT 행) — Message-ID 는 꺾쇠 없이 저장된다. */
  private long insertAppSent(long accountId, String messageId, String subject) {
    long folderId = folderRepo.ensureFolder(accountId, "SENT").id();
    return messageRepo.insertSent(
        accountId,
        folderId,
        new OutgoingMail(
            messageId,
            messageId,
            "box@test.local",
            "나",
            List.of("friend@example.com"),
            List.of(),
            List.of("hidden@example.com"),
            subject,
            "본문",
            null,
            null,
            null,
            "본문",
            Instant.now(),
            List.of(),
            List.of()));
  }

  private List<EmailMessageSummary> sentList(long accountId) {
    return messageRepo.listByAccount(accountId, "SENT", null, 50);
  }

  @Test
  void externalClientSentMail_appearsInSentList_notAsNewMail() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    appendSent("<ext-1@webmail.example>", "웹메일에서 보낸 메일");

    MailSyncResult result = syncService.sync(user, accountId);

    // 「새 메일 N건」은 받은편지함 기준 — 보낸 메일은 sentSaved 로 따로 센다
    assertThat(result.saved()).isZero();
    assertThat(result.sentSaved()).isEqualTo(1);
    assertThat(sentList(accountId))
        .extracting(EmailMessageSummary::subject)
        .containsExactly("웹메일에서 보낸 메일");
    assertThat(messageRepo.listByAccount(accountId, null, 50)).isEmpty();
    // 서버 폴더 이름으로 직접 찾지 않는다 — 보낸편지함(SENT) 보기로만 보인다(앱 발송본 사본 노출 방지)
    assertThat(messageRepo.listByAccount(accountId, "Sent", null, 50)).isEmpty();
    // 서버 폴더 이름 그대로의 로컬 폴더 행(보낸편지함 표시) — 본문·첨부를 이 이름으로 서버에서 연다
    assertThat(
            dsl.select(EMAIL_FOLDER.SERVER_SENT)
                .from(EMAIL_FOLDER)
                .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
                .and(EMAIL_FOLDER.NAME.eq("Sent"))
                .fetchOne(EMAIL_FOLDER.SERVER_SENT))
        .isTrue();
  }

  @Test
  void appSentMail_andItsServerCopy_showOnce() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    long appRow = insertAppSent(accountId, "app-1@genia.example", "앱에서 보낸 메일");
    // 앱 발송본의 서버 사본(IMAP APPEND — 같은 Message-ID) + 외부 클라이언트 발송본
    appendSent("<app-1@genia.example>", "앱에서 보낸 메일");
    appendSent("<ext-2@outlook.example>", "Outlook 에서 보낸 메일");

    MailSyncResult result = syncService.sync(user, accountId);

    assertThat(result.sentSaved()).isEqualTo(2);
    List<EmailMessageSummary> sent = sentList(accountId);
    // 앱 행(숨은 참조·첨부 기록이 있는 원본)을 남기고 사본은 가린다
    assertThat(sent)
        .extracting(EmailMessageSummary::subject)
        .containsExactlyInAnyOrder("앱에서 보낸 메일", "Outlook 에서 보낸 메일");
    assertThat(sent).extracting(EmailMessageSummary::id).contains(appRow);
  }

  @Test
  void secondSync_addsOnlyNewSentMail() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    appendSent("<ext-3@webmail.example>", "첫 번째");
    syncService.sync(user, accountId);
    // 백필이 목킹돼 첫 sync 의 진행 상태가 끝나지 않으므로(가드 유지) 2차 sync 가 UID 증분 경로를 타도록 수동 종료한다.
    progress.finish(accountId);

    appendSent("<ext-4@webmail.example>", "두 번째");
    MailSyncResult second = syncService.sync(user, accountId);

    assertThat(second.sentSaved()).isEqualTo(1);
    assertThat(sentList(accountId))
        .extracting(EmailMessageSummary::subject)
        .containsExactlyInAnyOrder("첫 번째", "두 번째");
  }

  @Test
  void inboxStillSyncs_whenServerHasNoSentFolder() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    MailTestPorts.sendText("box@test.local", "alice@example.com", "받은 메일", "본문");
    greenMail.waitForIncomingEmail(1);

    MailSyncResult result = syncService.sync(user, accountId);

    assertThat(result.saved()).isEqualTo(1);
    assertThat(result.sentSaved()).isZero();
    assertThat(sentList(accountId)).isEmpty();
  }
}
