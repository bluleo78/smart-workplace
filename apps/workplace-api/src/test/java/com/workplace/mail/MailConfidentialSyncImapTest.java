package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.store.MailFolder;
import com.icegreen.greenmail.user.GreenMailUser;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailMessageService;
import com.workplace.mail.service.MailSyncService;
import com.workplace.support.TestFixtures;
import jakarta.mail.Flags;
import jakarta.mail.Message;
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
 * 받은 메일 기밀 표시(WP-2030) IMAP 동기화 통합 테스트 — Sensitivity 헤더로 동기화 때 판정해 본문을 열기 전에도 목록에 기밀이 보이는지, 제목
 * 문구만으로는 판정하지 않는지, 이미 있는 공유 content 가 기밀로 올라가는지 본다.
 */
@Transactional
class MailConfidentialSyncImapTest extends MailSyncTestSupport {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new MailTestGreenMail()
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired MailMessageService messageService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  private static GreenMailUser boxUser() {
    return greenMail.getUserManager().getUser("box@test.local");
  }

  /** INBOX 에 메일을 넣는다. sensitivity 가 null 이면 헤더를 달지 않는다. */
  private void append(String subject, String sensitivity) throws Exception {
    MimeMessage m = new MimeMessage(Session.getInstance(new Properties()));
    m.setFrom(new InternetAddress("sender@example.com"));
    m.setRecipients(Message.RecipientType.TO, "box@test.local");
    m.setSubject(subject, "UTF-8");
    m.setText("본문 " + subject, "UTF-8");
    m.setSentDate(new Date());
    if (sensitivity != null) {
      m.setHeader("Sensitivity", sensitivity);
    }
    m.saveChanges();
    MailFolder inbox = greenMail.getManagers().getImapHostManager().getFolder(boxUser(), "INBOX");
    inbox.appendMessage(m, new Flags(), new Date());
  }

  @Test
  void sync_sensitivityHeader_marksConfidential_beforeBodyFetched() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    append("기밀 헤더 메일", "Company-Confidential");
    append("일반 메일", null);
    append("[기밀] 공지", null);

    syncService.sync(user, accountId);

    List<EmailMessageSummary> rows =
        messageService.list(user, accountId, "INBOX", null, null, false, null, false, 50);
    assertThat(rows).hasSize(3);
    assertThat(confidentialOf(rows, "기밀 헤더 메일")).isTrue();
    assertThat(confidentialOf(rows, "일반 메일")).isFalse();
    assertThat(confidentialOf(rows, "[기밀] 공지")).isFalse();
    // 본문을 열기 전 — fetched_at 이 비어 있어도 배지가 보여야 한다
    assertThat(
            dsl.fetchCount(
                EMAIL_MESSAGE,
                EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId),
                EMAIL_MESSAGE.FETCHED_AT.isNotNull()))
        .isZero();
  }

  @Test
  void sync_existingSharedContent_raisedToConfidential() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    append("워밍업", null);
    syncService.sync(user, accountId);
    long folderId =
        dsl.select(EMAIL_FOLDER.ID)
            .from(EMAIL_FOLDER)
            .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
            .and(EMAIL_FOLDER.NAME.eq("INBOX"))
            .fetchSingle(EMAIL_FOLDER.ID);

    String msgId = "<shared-" + System.nanoTime() + "@corp>";
    // 같은 Message-ID·지문(structure)의 메시지가 먼저 기밀 아님으로 들어간다
    Long first =
        messageRepo
            .insertIgnoreConflict(accountId, folderId, parsed(900001L, msgId, false))
            .orElseThrow();
    Long contentId = contentIdOf(first);
    assertThat(contentConfidential(contentId)).isFalse();

    // 다른 uid 의 같은 메시지가 기밀로 들어오면 공유 content 가 올라간다
    messageRepo.insertIgnoreConflict(accountId, folderId, parsed(900002L, msgId, true));
    assertThat(contentConfidential(contentId)).isTrue();
  }

  @Test
  void sync_existingEnvelope_raisesItsContent() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    append("워밍업", null);
    syncService.sync(user, accountId);
    long folderId =
        dsl.select(EMAIL_FOLDER.ID)
            .from(EMAIL_FOLDER)
            .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
            .and(EMAIL_FOLDER.NAME.eq("INBOX"))
            .fetchSingle(EMAIL_FOLDER.ID);
    String msgId = "<exist-" + System.nanoTime() + "@corp>";
    Long id =
        messageRepo
            .insertIgnoreConflict(accountId, folderId, parsed(900010L, msgId, false))
            .orElseThrow();
    Long contentId = contentIdOf(id);

    // 같은 envelope 를 기밀 판정으로 다시 동기화 — 새 행은 없지만 content 는 올라간다
    assertThat(messageRepo.insertIgnoreConflict(accountId, folderId, parsed(900010L, msgId, true)))
        .isEmpty();
    assertThat(contentConfidential(contentId)).isTrue();
  }

  /** 리뷰 후속: 기존 envelope 를 기밀로 올리면 상태 변화(목록 갱신 이벤트 근거)로 돌려주고, 이미 기밀이면 변화 없음. */
  @Test
  void insertForSync_raisingExistingEnvelope_reportsChange() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    append("워밍업", null);
    syncService.sync(user, accountId);
    long folderId =
        dsl.select(EMAIL_FOLDER.ID)
            .from(EMAIL_FOLDER)
            .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
            .and(EMAIL_FOLDER.NAME.eq("INBOX"))
            .fetchSingle(EMAIL_FOLDER.ID);
    String msgId = "<sse-" + System.nanoTime() + "@corp>";
    assertThat(messageRepo.insertForSync(accountId, folderId, parsed(900020L, msgId, false)))
        .isEqualTo(EmailMessageRepository.UpsertOutcome.INSERTED);
    assertThat(messageRepo.insertForSync(accountId, folderId, parsed(900020L, msgId, true)))
        .isEqualTo(EmailMessageRepository.UpsertOutcome.SEEN_CHANGED);
    assertThat(messageRepo.insertForSync(accountId, folderId, parsed(900020L, msgId, true)))
        .isEqualTo(EmailMessageRepository.UpsertOutcome.UNCHANGED);
  }

  private static boolean confidentialOf(List<EmailMessageSummary> rows, String subject) {
    return rows.stream()
        .filter(r -> subject.equals(r.subject()))
        .findFirst()
        .orElseThrow()
        .confidential();
  }

  private Long contentIdOf(long envelopeId) {
    return dsl.select(EMAIL_MESSAGE.CONTENT_ID)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(envelopeId))
        .fetchSingle(EMAIL_MESSAGE.CONTENT_ID);
  }

  private boolean contentConfidential(long contentId) {
    return dsl.select(EMAIL_CONTENT.CONFIDENTIAL)
        .from(EMAIL_CONTENT)
        .where(EMAIL_CONTENT.ID.eq(contentId))
        .fetchSingle(EMAIL_CONTENT.CONFIDENTIAL);
  }

  /** 공유 지문(structure)이 있는 IMAP 메타데이터 메시지. */
  private static ParsedMessage parsed(long uid, String msgId, boolean confidential) {
    return new ParsedMessage(
        uid,
        msgId,
        msgId,
        null,
        null,
        "sender@example.com",
        "Sender",
        "box@test.local",
        null,
        "공유 제목",
        Instant.now(),
        Instant.now(),
        false,
        false,
        null,
        null,
        null,
        List.of(),
        "TEXT/PLAIN:100",
        false,
        confidential);
  }
}
