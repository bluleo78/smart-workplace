package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.imap.ImapHostManager;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.store.MailFolder;
import com.icegreen.greenmail.user.GreenMailUser;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailListCursor;
import com.workplace.mail.dto.MailOlderResult;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailMessageService;
import com.workplace.mail.service.MailSummaryBackfillService;
import com.workplace.mail.service.MailSyncService;
import com.workplace.mail.service.folder.MailFolderService;
import com.workplace.mail.service.folder.MailFolderSyncGuard;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import jakarta.mail.Flags;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Properties;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * 받은편지함·보낸편지함 이전 메일 더 가져오기(WP-965) IMAP 통합 테스트 — GreenMail 받은편지함·「Sent」에 수신 시각(INTERNALDATE)을 정해
 * 메일을 넣고, 첫 동기화(최근 7일) 뒤 경계(가장 오래된 로컬 메일) 앞 90일씩 받아 경계를 옮기는지, 더 있는지(hasMore), 중복 없이 증분 커서를 지키는지, 목록
 * 커서 페이징이 빠짐·겹침 없이 끝까지 이어지는지 본다.
 */
@Transactional
class MailOlderMailboxImapTest extends ExternalClientMockedTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(MailTestPorts.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired MailFolderService folderService;
  @Autowired MailMessageService messageService;
  @Autowired MailFolderSyncGuard guard;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EncryptionService encryption;

  @MockitoBean MailBackfillService backfillService;
  @MockitoBean MailSummaryBackfillService summaryBackfillService;
  @Autowired AiAgentMailClient mailClient;

  /** 계정만 만든다. [user, account] */
  private long[] account() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    return new long[] {user, accountId};
  }

  @Test
  void inbox_fetches90DaysBeforeFirstSyncRange_movesBoundary_untilNoMore() throws Exception {
    long[] s = account();
    append("INBOX", "1일 전", 1);
    append("INBOX", "30일 전", 30);
    append("INBOX", "120일 전", 120);
    append("INBOX", "200일 전", 200);
    syncService.sync(s[0], s[1]); // 첫 동기화 — 최근 7일만, 그 시작을 경계로 기록한다
    assertThat(inboxSubjects(s)).containsExactly("1일 전");
    assertThat(
            dsl.select(EMAIL_FOLDER.SYNCED_SINCE)
                .from(EMAIL_FOLDER)
                .where(EMAIL_FOLDER.ACCOUNT_ID.eq(s[1]))
                .and(EMAIL_FOLDER.NAME.eq("INBOX"))
                .fetchOne(EMAIL_FOLDER.SYNCED_SINCE)
                .toInstant())
        .isBetween(
            Instant.now().minus(7, ChronoUnit.DAYS).minusSeconds(60),
            Instant.now().minus(7, ChronoUnit.DAYS));
    long cursor = lastSeenUid(s[1], "INBOX");

    // 첫 동기화가 기록한 경계(지금 − 7일) 앞 90일
    MailOlderResult first = folderService.fetchOlder(s[0], s[1], "INBOX");
    assertThat(first.running()).isFalse();
    assertThat(first.saved()).isEqualTo(1);
    assertThat(first.hasMore()).isTrue();
    assertThat(first.syncedSince())
        .isBetween(
            Instant.now().minus(98, ChronoUnit.DAYS), Instant.now().minus(96, ChronoUnit.DAYS));
    assertThat(inboxSubjects(s)).containsExactly("1일 전", "30일 전");

    // 저장된 경계 앞 90일 — 120일 전, 그 앞에도 200일 전이 남는다
    MailOlderResult second = folderService.fetchOlder(s[0], s[1], "INBOX");
    assertThat(second.saved()).isEqualTo(1);
    assertThat(second.syncedSince()).isEqualTo(first.syncedSince().minus(90, ChronoUnit.DAYS));
    assertThat(second.hasMore()).isTrue();

    // 200일 전까지 받고 나면 더 없다
    MailOlderResult third = folderService.fetchOlder(s[0], s[1], "INBOX");
    assertThat(third.saved()).isEqualTo(1);
    assertThat(third.hasMore()).isFalse();
    assertThat(inboxSubjects(s)).containsExactly("1일 전", "30일 전", "120일 전", "200일 전");

    // 증분 커서는 그대로, 다음 정기 동기화는 옛 메일을 다시 넣지 않는다
    assertThat(lastSeenUid(s[1], "INBOX")).isEqualTo(cursor);
    assertThat(syncService.sync(s[0], s[1]).saved()).isZero();
    assertThat(inboxSubjects(s)).hasSize(4);
  }

  @Test
  void sent_fetchesOlderServerSentMail_intoSentView() throws Exception {
    long[] s = account();
    append("Sent", "보낸 1일 전", 1);
    append("Sent", "보낸 40일 전", 40);
    syncService.sync(s[0], s[1]);
    assertThat(subjects(sentList(s))).containsExactly("보낸 1일 전");

    MailOlderResult r = folderService.fetchOlder(s[0], s[1], "SENT");

    assertThat(r.saved()).isEqualTo(1);
    assertThat(r.hasMore()).isFalse();
    assertThat(subjects(sentList(s))).containsExactly("보낸 1일 전", "보낸 40일 전");
  }

  @Test
  void inboxNotSyncedYet_isRunning_soTheScreenAsksAgainLater() {
    long[] s = account();

    MailOlderResult r = folderService.fetchOlder(s[0], s[1], "INBOX");

    // 「더 없음」으로 굳지 않게 — 첫 동기화가 끝나면 다시 물어 이어 받는다
    assertThat(r.running()).isTrue();
    assertThat(r.saved()).isZero();
    assertThat(r.hasMore()).isTrue();
  }

  @Test
  void noServerSentFolder_saysNoMore() throws Exception {
    long[] s = account();
    syncService.sync(s[0], s[1]); // 서버에 Sent 폴더가 없다 → 보낸편지함 행이 생기지 않는다

    MailOlderResult r = folderService.fetchOlder(s[0], s[1], "SENT");

    assertThat(r.running()).isFalse();
    assertThat(r.hasMore()).isFalse();
  }

  /** 다른 앱에서 받은편지함으로 되돌린 옛 메일 한 통이 경계를 끌어당겨 그 사이 메일을 건너뛰지 않는다. */
  @Test
  void oldMailMovedBackIntoInbox_doesNotPullTheBoundary() throws Exception {
    long[] s = account();
    append("INBOX", "30일 전", 30); // 첫 동기화 범위(7일) 밖 — 아직 안 받음
    syncService.sync(s[0], s[1]);
    append("INBOX", "3년 전 되돌린 메일", 1095); // 새 UID 라 증분이 받는다 → 가장 오래된 로컬 메일이 3년 전
    syncService.sync(s[0], s[1]);
    assertThat(inboxSubjects(s)).containsExactly("3년 전 되돌린 메일");

    MailOlderResult r = folderService.fetchOlder(s[0], s[1], "INBOX");

    assertThat(r.saved()).isEqualTo(1);
    assertThat(inboxSubjects(s)).containsExactly("30일 전", "3년 전 되돌린 메일");
  }

  @Test
  void alreadyRunning_returnsRunning_withoutFetching() throws Exception {
    long[] s = account();
    append("INBOX", "1일 전", 1);
    append("INBOX", "30일 전", 30);
    syncService.sync(s[0], s[1]);
    long inboxId = folderId(s[1], "INBOX");
    guard.tryStart(s[1], inboxId);
    try {
      MailOlderResult r = folderService.fetchOlder(s[0], s[1], "INBOX");
      assertThat(r.running()).isTrue();
      assertThat(r.hasMore()).isTrue();
      assertThat(inboxSubjects(s)).containsExactly("1일 전");
    } finally {
      guard.finish(s[1], inboxId);
    }
  }

  @Test
  void otherFolders_areRejected() {
    long[] s = account();
    assertThatThrownBy(() -> folderService.fetchOlder(s[0], s[1], "Projects"))
        .isInstanceOf(MailValidationException.class);
  }

  @Test
  void listCursor_pagesThroughWithoutGapsOrOverlap() throws Exception {
    long[] s = account();
    // 같은 수신 시각 두 통(정렬 동점은 id 로 가른다) 포함
    Date same = Date.from(Instant.now().minus(2, ChronoUnit.DAYS));
    for (int i = 1; i <= 5; i++) {
      inbox().appendMessage(text("메일 " + i), new Flags(), Date.from(daysAgo(i % 3)));
    }
    inbox().appendMessage(text("동점 A"), new Flags(), same);
    inbox().appendMessage(text("동점 B"), new Flags(), same);
    syncService.sync(s[0], s[1]);
    List<EmailMessageSummary> all =
        messageService.list(s[0], s[1], "INBOX", null, null, false, null, false, 50);
    assertThat(all).hasSize(7);

    List<EmailMessageSummary> paged = new ArrayList<>();
    MailListCursor cursor = null;
    for (int guardLoop = 0; guardLoop < 10; guardLoop++) {
      List<EmailMessageSummary> page =
          messageService.list(s[0], s[1], "INBOX", null, null, false, null, false, cursor, 2);
      paged.addAll(page);
      if (page.size() < 2) {
        break;
      }
      EmailMessageSummary last = page.get(page.size() - 1);
      cursor = new MailListCursor(last.receivedAt(), last.id());
    }
    // 한 번에 받은 목록과 같은 순서·같은 행
    assertThat(paged).extracting(EmailMessageSummary::id).containsExactlyElementsOf(ids(all));
  }

  // ---- 헬퍼 ----

  private static GreenMailUser boxUser() {
    return greenMail.getUserManager().getUser("box@test.local");
  }

  private static MailFolder inbox() throws Exception {
    return greenMail.getManagers().getImapHostManager().getInbox(boxUser());
  }

  /** 서버 폴더(INBOX 또는 Sent — 없으면 만든다)에 수신 시각을 정해 메일을 넣는다. */
  private static void append(String folder, String subject, int daysAgo) throws Exception {
    MailFolder target;
    if ("INBOX".equals(folder)) {
      target = inbox();
    } else {
      ImapHostManager imap = greenMail.getManagers().getImapHostManager();
      MailFolder existing = imap.getFolder(boxUser(), folder);
      target = existing != null ? existing : imap.createMailbox(boxUser(), folder);
    }
    target.appendMessage(text(subject), new Flags(), Date.from(daysAgo(daysAgo)));
  }

  private static Instant daysAgo(int days) {
    return Instant.now().minus(days, ChronoUnit.DAYS);
  }

  private static MimeMessage text(String subject) throws Exception {
    MimeMessage m = new MimeMessage(Session.getInstance(new Properties()));
    m.setFrom(new InternetAddress("sender@example.com"));
    m.setRecipients(Message.RecipientType.TO, "friend@example.com");
    m.setSubject(subject, "UTF-8");
    m.setText("본문 " + subject, "UTF-8");
    m.setSentDate(new Date());
    m.saveChanges();
    return m;
  }

  private List<String> inboxSubjects(long[] s) {
    return subjects(messageService.list(s[0], s[1], "INBOX", null, null, false, null, false, 50));
  }

  private List<EmailMessageSummary> sentList(long[] s) {
    return messageService.list(s[0], s[1], "SENT", null, null, false, null, false, 50);
  }

  private long folderId(long accountId, String name) {
    return dsl.select(EMAIL_FOLDER.ID)
        .from(EMAIL_FOLDER)
        .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_FOLDER.NAME.eq(name))
        .fetchOne(EMAIL_FOLDER.ID);
  }

  private long lastSeenUid(long accountId, String name) {
    return dsl.select(EMAIL_FOLDER.LAST_SEEN_UID)
        .from(EMAIL_FOLDER)
        .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_FOLDER.NAME.eq(name))
        .fetchOne(EMAIL_FOLDER.LAST_SEEN_UID);
  }

  private static List<String> subjects(List<EmailMessageSummary> rows) {
    return rows.stream().map(EmailMessageSummary::subject).toList();
  }

  private static List<Long> ids(List<EmailMessageSummary> rows) {
    return rows.stream().map(EmailMessageSummary::id).toList();
  }
}
