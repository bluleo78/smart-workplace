package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.store.MailFolder;
import com.icegreen.greenmail.user.GreenMailUser;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailFolderSyncResult;
import com.workplace.mail.dto.MarkAllReadRequest;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.exception.EmailFolderNotFoundException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.ImapReadSyncer;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailMessageService;
import com.workplace.mail.service.MailReadSyncer;
import com.workplace.mail.service.MailSummaryBackfillService;
import com.workplace.mail.service.MailSyncService;
import com.workplace.mail.service.folder.MailFolderService;
import com.workplace.mail.service.folder.MailFolderSyncGuard;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import jakarta.mail.Flags;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.Store;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
 * 메일함별 동기화(WP-960 Pass B) IMAP 통합 테스트 — GreenMail 의 사용자 폴더 「Projects」로 첫 동기화 90일 경계, 증분(새 메일·서버 읽음
 * 반영·서버 삭제 반영), 이전 메일 더 가져오기, 동시 실행 가드, 대상 검증(400·404), 폴더 보기(목록·건수·모두 읽음), 서버 폴더 안 읽은 수 증감, 읽음의 서버
 * 반영(폴더 이름으로 열기), 본문 열기를 본다.
 */
@Transactional
class MailFolderSyncImapTest extends IntegrationTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(MailTestPorts.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  private static final String PROJECTS = "Projects";

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired MailFolderService folderService;
  @Autowired MailMessageService messageService;
  @Autowired MailFolderSyncGuard guard;
  @Autowired ImapReadSyncer imapReadSyncer;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  @MockitoBean MailBackfillService backfillService;
  @MockitoBean MailSummaryBackfillService summaryBackfillService;
  @MockitoBean AiAgentMailClient mailClient;

  /** 계정·서버 폴더를 만들고 폴더 목록을 갱신(받은편지함 동기화)해 「Projects」 폴더 id 를 돌려준다. */
  private long[] setup() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    greenMail.getManagers().getImapHostManager().createMailbox(boxUser(), PROJECTS);
    syncService.sync(user, accountId);
    return new long[] {user, accountId, folderIdByName(accountId, PROJECTS)};
  }

  /** 서버 「Projects」에 수신 시각(INTERNALDATE)을 정해 메일을 넣는다. */
  private void appendDaysAgo(String subject, int daysAgo, boolean seen) throws Exception {
    MailFolder folder = greenMail.getManagers().getImapHostManager().getFolder(boxUser(), PROJECTS);
    Flags flags = new Flags();
    if (seen) {
      flags.add(Flags.Flag.SEEN);
    }
    folder.appendMessage(
        text(subject), flags, Date.from(Instant.now().minus(daysAgo, ChronoUnit.DAYS)));
  }

  @Test
  void firstSync_takesLast90Days_andFolderViewsAreScoped() throws Exception {
    long[] s = setup();
    appendDaysAgo("최근 메일", 1, false);
    appendDaysAgo("89일 전", 89, true);
    appendDaysAgo("91일 전", 91, false);

    MailFolderSyncResult r = folderService.syncFolder(s[0], s[1], s[2], false);

    assertThat(r.running()).isFalse();
    assertThat(r.saved()).isEqualTo(2);
    // 경계 = 지금 − 90일(초 단위), 가져온 시각 기록
    assertThat(r.syncedSince())
        .isBetween(
            Instant.now().minus(90, ChronoUnit.DAYS).minus(Duration.ofMinutes(1)),
            Instant.now().minus(90, ChronoUnit.DAYS));
    assertThat(r.folderSyncedAt()).isNotNull();

    // folderId 보기: 그 폴더 메일만, 분류 인자는 무시
    assertThat(subjects(messageService.list(s[0], s[1], null, s[2], null, false, "업무", true, 50)))
        .containsExactlyInAnyOrder("최근 메일", "89일 전");
    assertThat(
            subjects(messageService.list(s[0], s[1], "INBOX", null, null, false, null, false, 50)))
        .isEmpty();
    assertThat(messageService.unreadCountInView(s[0], s[1], s[2], null, false, null).count())
        .isEqualTo(1);
  }

  @Test
  void incrementalSync_addsNew_appliesServerSeen_andRemovesDeleted() throws Exception {
    long[] s = setup();
    appendDaysAgo("최근 메일", 1, false);
    appendDaysAgo("지울 메일", 2, false);
    folderService.syncFolder(s[0], s[1], s[2], false);
    long lastSeenBefore = lastSeenUid(s[2]);

    appendDaysAgo("새 메일", 0, false);
    withStore(
        store -> {
          Folder f = store.getFolder(PROJECTS);
          f.open(Folder.READ_WRITE);
          for (Message m : f.getMessages()) {
            if ("최근 메일".equals(m.getSubject())) {
              m.setFlag(Flags.Flag.SEEN, true); // 다른 앱에서 읽음
            }
            if ("지울 메일".equals(m.getSubject())) {
              m.setFlag(Flags.Flag.DELETED, true);
            }
          }
          f.close(true); // expunge
        });

    MailFolderSyncResult r = folderService.syncFolder(s[0], s[1], s[2], false);

    assertThat(r.saved()).isEqualTo(1);
    assertThat(r.seenChanged()).isEqualTo(1);
    assertThat(r.removed()).isEqualTo(1);
    assertThat(lastSeenUid(s[2])).isGreaterThan(lastSeenBefore);
    List<EmailMessageSummary> rows =
        messageService.list(s[0], s[1], null, s[2], null, false, null, false, 50);
    assertThat(subjects(rows)).containsExactlyInAnyOrder("최근 메일", "새 메일");
    assertThat(rows)
        .filteredOn(m -> m.subject().equals("최근 메일"))
        .singleElement()
        .satisfies(m -> assertThat(m.seen()).isTrue());
  }

  @Test
  void older_fetchesThePrevious90Days_movesBoundary_keepsCursor() throws Exception {
    long[] s = setup();
    appendDaysAgo("최근 메일", 1, false);
    appendDaysAgo("91일 전", 91, false);
    appendDaysAgo("200일 전", 200, false);
    MailFolderSyncResult first = folderService.syncFolder(s[0], s[1], s[2], false);
    long cursor = lastSeenUid(s[2]);

    MailFolderSyncResult older = folderService.syncFolder(s[0], s[1], s[2], true);

    assertThat(older.saved()).isEqualTo(1);
    assertThat(older.syncedSince()).isEqualTo(first.syncedSince().minus(90, ChronoUnit.DAYS));
    assertThat(lastSeenUid(s[2])).isEqualTo(cursor); // 증분 커서 불변
    assertThat(subjects(messageService.list(s[0], s[1], null, s[2], null, false, null, false, 50)))
        .containsExactlyInAnyOrder("최근 메일", "91일 전");

    // 한 번 더 — 그 앞 90일(200일 전 메일)
    MailFolderSyncResult older2 = folderService.syncFolder(s[0], s[1], s[2], true);
    assertThat(older2.saved()).isEqualTo(1);
    assertThat(older2.syncedSince()).isEqualTo(first.syncedSince().minus(180, ChronoUnit.DAYS));
    assertThat(lastSeenUid(s[2])).isEqualTo(cursor);

    // 증분은 이미 받은 것을 다시 넣지 않는다
    assertThat(folderService.syncFolder(s[0], s[1], s[2], false).saved()).isZero();
  }

  /** 창(90일) 밖 메일만 있는 폴더 — 첫 동기화 0건 뒤 커서가 UIDNEXT−1 로 올라가 다음 증분이 과거 메일을 끌어오지 않는다. */
  @Test
  void firstSync_onlyOldMail_cursorJumpsToUidNext_soIncrementalSkipsHistory() throws Exception {
    long[] s = setup();
    appendDaysAgo("100일 전", 100, false);
    appendDaysAgo("120일 전", 120, false);

    MailFolderSyncResult first = folderService.syncFolder(s[0], s[1], s[2], false);
    assertThat(first.fetched()).isZero();
    assertThat(lastSeenUid(s[2])).isPositive();

    MailFolderSyncResult again = folderService.syncFolder(s[0], s[1], s[2], false);
    assertThat(again.fetched()).isZero();

    appendDaysAgo("새 메일", 0, false);
    MailFolderSyncResult next = folderService.syncFolder(s[0], s[1], s[2], false);
    assertThat(next.fetched()).isEqualTo(1);
    assertThat(next.saved()).isEqualTo(1);
    assertThat(subjects(messageService.list(s[0], s[1], null, s[2], null, false, null, false, 50)))
        .containsExactly("새 메일");
  }

  @Test
  void older_onNeverSyncedFolder_doesFirstSync() throws Exception {
    long[] s = setup();
    appendDaysAgo("최근 메일", 1, false);

    MailFolderSyncResult r = folderService.syncFolder(s[0], s[1], s[2], true);

    assertThat(r.saved()).isEqualTo(1);
    assertThat(r.syncedSince()).isNotNull();
  }

  @Test
  void concurrentSyncOfSameFolder_returnsRunning() throws Exception {
    long[] s = setup();
    appendDaysAgo("최근 메일", 1, false);
    assertThat(guard.tryStart(s[1], s[2])).isTrue();
    try {
      MailFolderSyncResult r = folderService.syncFolder(s[0], s[1], s[2], false);
      assertThat(r.running()).isTrue();
      assertThat(r.saved()).isZero();
      assertThat(folderTarget(s[1], s[2]).folderSyncedAt()).isNull(); // 아무것도 하지 않았다
    } finally {
      guard.finish(s[1], s[2]);
    }
    // 끝나면 다시 가져올 수 있다
    assertThat(folderService.syncFolder(s[0], s[1], s[2], false).saved()).isEqualTo(1);
  }

  @Test
  void syncFolder_rejectsInboxSentNoselect_andHidesOtherAccounts() throws Exception {
    long[] s = setup();
    long inbox = folderIdByName(s[1], "INBOX");
    long sent = folderRepo.ensureFolder(s[1], "SENT").id();
    assertThatThrownBy(() -> folderService.syncFolder(s[0], s[1], inbox, false))
        .isInstanceOf(MailValidationException.class);
    assertThatThrownBy(() -> folderService.syncFolder(s[0], s[1], sent, false))
        .isInstanceOf(MailValidationException.class);
    dsl.update(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.SELECTABLE, false)
        .where(EMAIL_FOLDER.ID.eq(s[2]))
        .execute();
    assertThatThrownBy(() -> folderService.syncFolder(s[0], s[1], s[2], false))
        .isInstanceOf(MailValidationException.class);
    assertThatThrownBy(() -> folderService.syncFolder(s[0], s[1], Long.MAX_VALUE, false))
        .isInstanceOf(EmailFolderNotFoundException.class);

    // 다른 계정의 폴더 id 를 내 계정 경로로 → 404
    long other = TestFixtures.createHuman(dsl);
    long otherAccount = MailTestSupport.insertAccount(accountRepo, encryption, other, false);
    long otherFolder =
        folderRepo
            .upsertServerFolder(otherAccount, "Other", "Other", "Other", "USER", true, 0, 0, null)
            .orElseThrow();
    assertThatThrownBy(() -> folderService.syncFolder(s[0], s[1], otherFolder, false))
        .isInstanceOf(EmailFolderNotFoundException.class);
    assertThatThrownBy(
            () -> messageService.list(s[0], s[1], null, otherFolder, null, false, null, false, 50))
        .isInstanceOf(EmailFolderNotFoundException.class);
  }

  @Test
  void appReadChanges_adjustServerUnread_neverBelowZero_nullUntouched() throws Exception {
    long[] s = setup();
    appendDaysAgo("하나", 1, false);
    appendDaysAgo("둘", 2, false);
    appendDaysAgo("셋", 3, false);
    folderService.syncFolder(s[0], s[1], s[2], false);
    setServerUnread(s[2], 3);
    List<EmailMessageSummary> rows =
        messageService.list(s[0], s[1], null, s[2], null, false, null, false, 50);
    long one = idOf(rows, "하나");

    messageService.markRead(s[0], one);
    assertThat(serverUnread(s[2])).isEqualTo(2);
    messageService.markRead(s[0], one); // 이미 읽음 — 변화 없음
    assertThat(serverUnread(s[2])).isEqualTo(2);
    messageService.markUnread(s[0], one);
    assertThat(serverUnread(s[2])).isEqualTo(3);

    // 모두 읽음(folderId 보기) — 바뀐 수만큼
    int updated =
        messageService.markAllRead(
            s[0],
            s[1],
            s[2],
            new MarkAllReadRequest(
                null, false, null, java.time.OffsetDateTime.now().plusMinutes(1)));
    assertThat(updated).isEqualTo(3);
    assertThat(serverUnread(s[2])).isZero();

    // 0 아래로 내려가지 않는다
    messageService.markUnread(s[0], one);
    setServerUnread(s[2], 0);
    messageService.markRead(s[0], one);
    assertThat(serverUnread(s[2])).isZero();

    // 개수를 모르면(NULL) 그대로
    messageService.markUnread(s[0], one);
    dsl.update(EMAIL_FOLDER)
        .setNull(EMAIL_FOLDER.SERVER_UNREAD)
        .where(EMAIL_FOLDER.ID.eq(s[2]))
        .execute();
    messageService.markRead(s[0], one);
    assertThat(serverUnread(s[2])).isNull();
  }

  @Test
  void readPush_opensTheServerFolderByName() throws Exception {
    long[] s = setup();
    appendDaysAgo("폴더 메일", 1, false);
    folderService.syncFolder(s[0], s[1], s[2], false);
    long id =
        idOf(messageService.list(s[0], s[1], null, s[2], null, false, null, false, 50), "폴더 메일");

    messageService.markRead(s[0], id);
    List<SeenSyncItem> due = messageRepo.findDueSeenSyncItems(s[1], 10);
    assertThat(due)
        .singleElement()
        .satisfies(
            i -> {
              assertThat(i.messageId()).isEqualTo(id);
              assertThat(i.locator().folderName()).isEqualTo(PROJECTS);
            });
    EmailAccountResponse account = accountRepo.findByIdAndUser(s[0], s[1]).orElseThrow();
    try (MailReadSyncer.Session session = imapReadSyncer.open(s[0], account)) {
      assertThat(session.push(due).succeeded()).containsExactly(id);
    }
    assertThat(isServerSeen("폴더 메일")).isTrue();
  }

  /** 서버 메일함 메일은 백그라운드 본문 보충 대상이 아니다(열 때만 적재) — 보관함 90일치를 통째로 받지 않게. */
  @Test
  void backgroundBodyBackfill_skipsFolderMessages() throws Exception {
    long[] s = setup();
    appendDaysAgo("폴더 메일", 1, false);
    MailTestPorts.sendText("box@test.local", "a@example.com", "받은 메일", "본문");
    greenMail.waitForIncomingEmail(1);
    syncService.sync(s[0], s[1]);
    folderService.syncFolder(s[0], s[1], s[2], false);

    assertThat(messageRepo.countMissingBody(s[1])).isEqualTo(1);
    assertThat(messageRepo.listMissingBody(s[1], 50))
        .singleElement()
        .satisfies(t -> assertThat(t.folderName()).isEqualTo("INBOX"));
  }

  @Test
  void bodyLoads_forFolderMessage() throws Exception {
    long[] s = setup();
    appendDaysAgo("본문 확인", 1, false);
    folderService.syncFolder(s[0], s[1], s[2], false);
    long id =
        idOf(messageService.list(s[0], s[1], null, s[2], null, false, null, false, 50), "본문 확인");

    EmailMessageDetail detail = messageService.get(s[0], id, false);

    assertThat(detail.bodyText()).contains("폴더 본문");
  }

  // ---- 헬퍼 ----

  private static GreenMailUser boxUser() {
    return greenMail.getUserManager().getUser("box@test.local");
  }

  private static MimeMessage text(String subject) throws Exception {
    MimeMessage m = new MimeMessage(Session.getInstance(new Properties()));
    m.setFrom(new InternetAddress("sender@example.com"));
    m.setRecipients(Message.RecipientType.TO, "box@test.local");
    m.setSubject(subject, "UTF-8");
    m.setText("폴더 본문 " + subject, "UTF-8");
    m.setSentDate(new Date());
    m.saveChanges();
    return m;
  }

  private interface StoreWork {
    void run(Store store) throws Exception;
  }

  private static void withStore(StoreWork work) throws Exception {
    Properties props = new Properties();
    props.put("mail.store.protocol", "imap");
    Store store = Session.getInstance(props).getStore("imap");
    store.connect("127.0.0.1", MailTestPorts.IMAP, "box@test.local", "pw");
    try {
      work.run(store);
    } finally {
      store.close();
    }
  }

  private static boolean isServerSeen(String subject) throws Exception {
    boolean[] seen = {false};
    withStore(
        store -> {
          Folder f = store.getFolder(PROJECTS);
          f.open(Folder.READ_ONLY);
          for (Message m : f.getMessages()) {
            if (subject.equals(m.getSubject())) {
              seen[0] = m.isSet(Flags.Flag.SEEN);
            }
          }
          f.close(false);
        });
    return seen[0];
  }

  private long folderIdByName(long accountId, String name) {
    return dsl.select(EMAIL_FOLDER.ID)
        .from(EMAIL_FOLDER)
        .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_FOLDER.NAME.eq(name))
        .fetchSingle(EMAIL_FOLDER.ID);
  }

  private EmailFolderRepository.FolderTarget folderTarget(long accountId, long folderId) {
    return folderRepo.findTarget(accountId, folderId).orElseThrow();
  }

  private long lastSeenUid(long folderId) {
    return dsl.select(EMAIL_FOLDER.LAST_SEEN_UID)
        .from(EMAIL_FOLDER)
        .where(EMAIL_FOLDER.ID.eq(folderId))
        .fetchSingle(EMAIL_FOLDER.LAST_SEEN_UID);
  }

  private Integer serverUnread(long folderId) {
    return dsl.select(EMAIL_FOLDER.SERVER_UNREAD)
        .from(EMAIL_FOLDER)
        .where(EMAIL_FOLDER.ID.eq(folderId))
        .fetchSingle(EMAIL_FOLDER.SERVER_UNREAD);
  }

  private void setServerUnread(long folderId, int value) {
    dsl.update(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.SERVER_UNREAD, value)
        .where(EMAIL_FOLDER.ID.eq(folderId))
        .execute();
  }

  private static List<String> subjects(List<EmailMessageSummary> rows) {
    return rows.stream().map(EmailMessageSummary::subject).toList();
  }

  private static long idOf(List<EmailMessageSummary> rows, String subject) {
    return rows.stream().filter(r -> subject.equals(r.subject())).findFirst().orElseThrow().id();
  }
}
