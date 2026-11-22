package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.dto.SeenSyncResult;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.ImapConnector;
import com.workplace.mail.service.ImapReadSyncer;
import com.workplace.mail.service.MailReadSyncer;
import com.workplace.mail.service.MailSyncProgress;
import com.workplace.mail.service.MailSyncService;
import com.workplace.support.TestFixtures;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * WP-187 IMAP 역동기화 — 접속 1회에 UID 묶음으로 \Seen 켜기/끄기.
 *
 * <p><b>@Transactional 금지</b>: 동기화가 짧은 트랜잭션으로 커밋한 행을 그대로 쓰고, 세션 열기는 운영(디스패처)과 같이 {@code
 * cleanupInTenant} 의 테넌트 트랜잭션 안에서 부른다 — 그래야 비밀번호 조회가 RLS 로 0행이 되는 회귀(#444)를 잡는다. 시드는
 * {@code @AfterEach} 에서 회수한다(ImapSeenSyncFailureTest 와 같은 구성).
 */
class ImapReadSyncerTest extends MailSyncTestSupport {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new MailTestGreenMail()
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EncryptionService encryption;
  @Autowired MailSyncProgress progress;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired ImapReadSyncer imapReadSyncer;
  @Autowired com.workplace.mail.service.MailReadSyncDispatcher dispatcher;

  /** 접속 횟수·트랜잭션 밖 접속 확인용(WP-215) — 실제 접속은 그대로 한다. */
  @Autowired ImapConnector imapConnector;

  /** ai-agent 실호출 차단. */
  @Autowired AiAgentMailClient mailClient;

  private Long seededUser;
  private Long seededAccount;

  @AfterEach
  void cleanup() {
    if (seededAccount != null) {
      progress.discardForTest(seededAccount);
      // 계정 삭제가 folder·message 를 CASCADE 로 함께 지운다
      cleanupInTenant(
          1L,
          () -> dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(seededAccount)).execute());
    }
    if (seededUser != null) {
      cleanupInTenant(1L, () -> dsl.deleteFrom(USER).where(USER.ID.eq(seededUser)).execute());
    }
    TenantContext.clear();
  }

  @SuppressWarnings("unchecked")
  @Test
  void setsAndClearsSeen_inOneConnection_acrossPushes() throws Exception {
    TenantContext.set(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.insertAccount(accountRepo, encryption, seededUser, false);
    MailTestPorts.sendText("box@test.local", "a@example.com", "읽을 메일", "본문");
    MailTestPorts.sendText("box@test.local", "b@example.com", "되돌릴 메일", "본문");
    greenMail.waitForIncomingEmail(2);
    MailTestPorts.setServerSeen("되돌릴 메일", true);
    syncService.sync(seededUser, seededAccount);
    progress.discardForTest(seededAccount);

    long[] ids = new long[3];
    List<SeenSyncItem>[] items = new List[1];
    EmailAccountResponse[] account = new EmailAccountResponse[1];
    cleanupInTenant(
        1L,
        () -> {
          List<EmailMessageSummary> rows = messageRepo.listByAccount(seededAccount, null, 50);
          ids[0] = idOf(rows, "읽을 메일");
          ids[1] = idOf(rows, "되돌릴 메일");
          ids[2] = insertLocalPendingRow(); // 서버 UID 없는 로컬 행 — 반영할 것이 없으니 끝난 것으로 본다
          assertThat(messageRepo.markSeen(ids[0])).isEqualTo(1);
          assertThat(messageRepo.markUnseen(ids[1])).isEqualTo(1);
          items[0] = messageRepo.findDueSeenSyncItems(seededAccount, 10);
          account[0] = accountRepo.findByIdAndUser(seededUser, seededAccount).orElseThrow();
        });
    assertThat(items[0]).hasSize(3);
    assertThat(MailTestPorts.isServerSeen("읽을 메일")).isFalse();
    assertThat(MailTestPorts.isServerSeen("되돌릴 메일")).isTrue();

    // 운영(디스패처)처럼 세션은 테넌트 트랜잭션 안에서 연다 — 비밀번호를 실제로 읽어야 서버 상태가 바뀐다(#444).
    // 반영(push)은 트랜잭션 밖에서 한다 — 원격 호출 동안 DB 커넥션을 잡지 않는다(WP-215).
    MailReadSyncer.Session[] session = new MailReadSyncer.Session[1];
    cleanupInTenant(1L, () -> session[0] = imapReadSyncer.open(seededUser, account[0]));
    // 접속이 트랜잭션 밖에서 일어나는지 기록한다 — 위 동기화의 접속은 세지 않도록 기록을 비우고 시작
    org.mockito.Mockito.clearInvocations(imapConnector);
    boolean[] connectedInTx = {false};
    org.mockito.Mockito.doAnswer(
            inv -> {
              connectedInTx[0] |= TransactionSynchronizationManager.isActualTransactionActive();
              return inv.callRealMethod();
            })
        .when(imapConnector)
        .connect(any(), any());
    // 디스패처의 조각처럼 두 번 나눠 보낸다 — 같은 세션이면 접속·로그인은 한 번
    Set<Long> succeeded = new HashSet<>();
    try (MailReadSyncer.Session s = session[0]) {
      SeenSyncResult first = s.push(items[0].subList(0, 1));
      SeenSyncResult rest = s.push(items[0].subList(1, items[0].size()));
      assertThat(first.stopped()).isFalse();
      assertThat(rest.stopped()).isFalse();
      succeeded.addAll(first.succeeded());
      succeeded.addAll(rest.succeeded());
    }
    verify(imapConnector, times(1)).connect(any(), any());
    assertThat(connectedInTx[0]).isFalse();

    assertThat(succeeded).containsExactlyInAnyOrder(ids[0], ids[1], ids[2]);
    assertThat(MailTestPorts.isServerSeen("읽을 메일")).isTrue();
    assertThat(MailTestPorts.isServerSeen("되돌릴 메일")).isFalse();
  }

  /** 메일 2통을 받아 첫 동기화까지 마친다(별표 테스트 공용). */
  private void seedTwoMails() throws Exception {
    TenantContext.set(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.insertAccount(accountRepo, encryption, seededUser, false);
    MailTestPorts.sendText("box@test.local", "a@example.com", "별표 켤 메일", "본문");
    MailTestPorts.sendText("box@test.local", "b@example.com", "별표 끌 메일", "본문");
    greenMail.waitForIncomingEmail(2);
    MailTestPorts.setServerFlagged("별표 끌 메일", true);
    syncService.sync(seededUser, seededAccount);
    progress.discardForTest(seededAccount);
  }

  /** 두 메일의 별표를 뒤집고(켜기·끄기) 대기 항목과 계정을 돌려준다. */
  private List<SeenSyncItem> flipFlags(long[] ids, EmailAccountResponse[] account) {
    List<SeenSyncItem>[] items = new List[1];
    cleanupInTenant(
        1L,
        () -> {
          List<EmailMessageSummary> rows = messageRepo.listByAccount(seededAccount, null, 50);
          ids[0] = idOf(rows, "별표 켤 메일");
          ids[1] = idOf(rows, "별표 끌 메일");
          // 첫 동기화가 서버 \Flagged 를 읽어 넣었다
          assertThat(
                  rows.stream().filter(r -> r.id() == ids[1]).findFirst().orElseThrow().flagged())
              .isTrue();
          assertThat(messageRepo.markFlagged(ids[0], true)).isEqualTo(1);
          assertThat(messageRepo.markFlagged(ids[1], false)).isEqualTo(1);
          items[0] = messageRepo.findDueSeenSyncItems(seededAccount, 10);
          account[0] = accountRepo.findByIdAndUser(seededUser, seededAccount).orElseThrow();
        });
    return items[0];
  }

  /** WP-1741: 별표 반영 — 별표 대기 항목은 STORE +FLAGS/-FLAGS (\Flagged) 로, 읽음은 건드리지 않는다. */
  @SuppressWarnings("unchecked")
  @Test
  void setsAndClearsFlagged() throws Exception {
    seedTwoMails();
    long[] ids = new long[2];
    EmailAccountResponse[] account = new EmailAccountResponse[1];
    List<SeenSyncItem> items = flipFlags(ids, account);
    // 별표만 대기 — 읽음 값은 싣지 않는다(서버 읽음을 덮지 않게)
    assertThat(items).hasSize(2).allSatisfy(it -> assertThat(it.seen()).isNull());

    MailReadSyncer.Session[] session = new MailReadSyncer.Session[1];
    cleanupInTenant(1L, () -> session[0] = imapReadSyncer.open(seededUser, account[0]));
    SeenSyncResult r;
    try (MailReadSyncer.Session s = session[0]) {
      r = s.push(items);
    }

    assertThat(r.succeeded()).containsExactlyInAnyOrder(ids[0], ids[1]);
    assertThat(MailTestPorts.isServerFlagged("별표 켤 메일")).isTrue();
    assertThat(MailTestPorts.isServerFlagged("별표 끌 메일")).isFalse();
    assertThat(MailTestPorts.isServerSeen("별표 켤 메일")).isFalse();
  }

  /**
   * WP-1741: 메일함 PERMANENTFLAGS 에 \Flagged·\* 가 없으면 별표는 서버에 보내지 않고 앱 안에만 둔다 — 끝난 것으로 돌려주되 「앱 안에만」으로
   * 표시하고, 디스패처는 대기를 보류해 재시도도 하지 않고 동기화가 로컬 별표를 지우지도 않게 한다.
   */
  @SuppressWarnings("unchecked")
  @Test
  void unsupportedPermanentFlags_keepsFlagLocal_andReportsDone() throws Exception {
    seedTwoMails();
    long[] ids = new long[2];
    EmailAccountResponse[] account = new EmailAccountResponse[1];
    List<SeenSyncItem> items = flipFlags(ids, account);

    // 접속한 Store 가 돌려주는 메일함의 PERMANENTFLAGS 를 \Seen 만으로 바꾼다(실제 서버 접속·STORE 는 그대로)
    org.mockito.Mockito.doAnswer(
            inv -> {
              jakarta.mail.Store real = (jakarta.mail.Store) inv.callRealMethod();
              jakarta.mail.Store store = org.mockito.Mockito.spy(real);
              org.mockito.Mockito.doAnswer(
                      g -> {
                        org.eclipse.angus.mail.imap.IMAPFolder f =
                            org.mockito.Mockito.spy(
                                (org.eclipse.angus.mail.imap.IMAPFolder) g.callRealMethod());
                        org.mockito.Mockito.doReturn(
                                new jakarta.mail.Flags(jakarta.mail.Flags.Flag.SEEN))
                            .when(f)
                            .getPermanentFlags();
                        return f;
                      })
                  .when(store)
                  .getFolder(org.mockito.ArgumentMatchers.anyString());
              return store;
            })
        .when(imapConnector)
        .connect(any(), any());

    MailReadSyncer.Session[] session = new MailReadSyncer.Session[1];
    cleanupInTenant(1L, () -> session[0] = imapReadSyncer.open(seededUser, account[0]));
    SeenSyncResult r;
    try (MailReadSyncer.Session s = session[0]) {
      r = s.push(items);
    }

    assertThat(r.succeeded()).containsExactlyInAnyOrder(ids[0], ids[1]);
    assertThat(r.flagLocalOnly()).containsExactlyInAnyOrder(ids[0], ids[1]);
    // 서버 별표는 그대로
    assertThat(MailTestPorts.isServerFlagged("별표 켤 메일")).isFalse();
    assertThat(MailTestPorts.isServerFlagged("별표 끌 메일")).isTrue();

    // 디스패처 경로: 대기를 풀지 않고 보류(먼 미래로 미룸) — 재시도 대상이 아니고, 이어지는 동기화가 서버 값으로 로컬 별표를 덮지 않는다
    TenantContext.set(1L);
    dispatcher.dispatchAccount(seededUser, seededAccount);
    cleanupInTenant(
        1L,
        () -> {
          var row = dsl.selectFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ID.eq(ids[0])).fetchOne();
          assertThat(row.getFlaggedPushPending()).isTrue();
          assertThat(row.getFlaggedPushNextAt())
              .isAfter(java.time.OffsetDateTime.now().plusYears(50));
          assertThat(messageRepo.findDueSeenSyncItems(seededAccount, 10)).isEmpty();
        });
    syncService.sync(seededUser, seededAccount);
    progress.discardForTest(seededAccount);
    cleanupInTenant(
        1L,
        () -> {
          List<EmailMessageSummary> rows = messageRepo.listByAccount(seededAccount, null, 50);
          assertThat(
                  rows.stream().filter(x -> x.id() == ids[0]).findFirst().orElseThrow().flagged())
              .as("앱 안에만 둔 별표는 동기화 뒤에도 남는다")
              .isTrue();
          assertThat(
                  rows.stream().filter(x -> x.id() == ids[1]).findFirst().orElseThrow().flagged())
              .isFalse();
        });
  }

  /** WP-1741: PERMANENTFLAGS 판정 — \Flagged 또는 \*(USER) 가 있거나 목록이 없으면 지원. */
  @Test
  void supportsFlagged_rules() {
    assertThat(ImapReadSyncer.supportsFlagged(null)).isTrue();
    assertThat(
            ImapReadSyncer.supportsFlagged(new jakarta.mail.Flags(jakarta.mail.Flags.Flag.FLAGGED)))
        .isTrue();
    assertThat(ImapReadSyncer.supportsFlagged(new jakarta.mail.Flags(jakarta.mail.Flags.Flag.USER)))
        .isTrue();
    assertThat(ImapReadSyncer.supportsFlagged(new jakarta.mail.Flags(jakarta.mail.Flags.Flag.SEEN)))
        .isFalse();
  }

  private static long idOf(List<EmailMessageSummary> rows, String subject) {
    return rows.stream().filter(r -> subject.equals(r.subject())).findFirst().orElseThrow().id();
  }

  /** 동기화로 생긴 INBOX 에 imap_uid 없는 읽음·반영 대기 행을 하나 넣는다(로컬 생성 행 흉내). */
  private long insertLocalPendingRow() {
    long folderId =
        dsl.select(EMAIL_FOLDER.ID)
            .from(EMAIL_FOLDER)
            .where(EMAIL_FOLDER.ACCOUNT_ID.eq(seededAccount))
            .and(EMAIL_FOLDER.NAME.eq("INBOX"))
            .fetchOne(EMAIL_FOLDER.ID);
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, seededAccount)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.THREAD_ID, "thread-local-" + System.nanoTime())
        .set(EMAIL_MESSAGE.SEEN, true)
        .set(EMAIL_MESSAGE.SEEN_PUSH_PENDING, true)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }
}
