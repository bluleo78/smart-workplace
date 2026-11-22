package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailSyncProgress;
import com.workplace.mail.service.MailSyncService;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * WP-1741 IMAP 별표 받아오기 — 신규 적재와 기존 메일 FLAGS 재조회가 \Flagged 를 읽는다. 최근 범위(14일) 밖이라도 로컬에 별표가 켜진 메일은 다시
 * 읽어 다른 앱에서 끈 별표를 반영한다. 반영 대기 중인 속성은 덮지 않고, 읽음 대기·별표 대기는 서로의 갱신을 막지 않는다.
 *
 * <p><b>@Transactional 금지</b>: 동기화가 짧은 트랜잭션으로 커밋한 행을 그대로 본다(ImapReadSyncerTest 와 같은 구성). 시드는
 * {@code @AfterEach} 에서 회수한다.
 */
class ImapFlagSyncTest extends MailSyncTestSupport {

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

  /** ai-agent 실호출 차단. */
  @Autowired AiAgentMailClient mailClient;

  private Long seededUser;
  private Long seededAccount;

  @AfterEach
  void cleanup() {
    if (seededAccount != null) {
      progress.discardForTest(seededAccount);
      cleanupInTenant(
          1L,
          () -> dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(seededAccount)).execute());
    }
    if (seededUser != null) {
      cleanupInTenant(1L, () -> dsl.deleteFrom(USER).where(USER.ID.eq(seededUser)).execute());
    }
    TenantContext.clear();
  }

  /** 메일 A·B 를 받고(A 는 서버에서 별표) 첫 동기화까지 마친다. */
  private void seedAndFirstSync() throws Exception {
    TenantContext.set(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.insertAccount(accountRepo, encryption, seededUser, false);
    MailTestPorts.sendText("box@test.local", "a@example.com", "메일 A", "본문");
    MailTestPorts.sendText("box@test.local", "b@example.com", "메일 B", "본문");
    greenMail.waitForIncomingEmail(2);
    MailTestPorts.setServerFlagged("메일 A", true);
    sync();
  }

  private void sync() {
    syncService.sync(seededUser, seededAccount);
    progress.discardForTest(seededAccount);
  }

  private long idOf(String subject) {
    long[] id = new long[1];
    cleanupInTenant(
        1L,
        () -> {
          List<EmailMessageSummary> rows = messageRepo.listByAccount(seededAccount, null, 50);
          id[0] =
              rows.stream().filter(r -> subject.equals(r.subject())).findFirst().orElseThrow().id();
        });
    return id[0];
  }

  private boolean flagged(long id) {
    boolean[] v = new boolean[1];
    cleanupInTenant(
        1L,
        () ->
            v[0] =
                dsl.select(EMAIL_MESSAGE.FLAGGED)
                    .from(EMAIL_MESSAGE)
                    .where(EMAIL_MESSAGE.ID.eq(id))
                    .fetchOne(EMAIL_MESSAGE.FLAGGED));
    return v[0];
  }

  private boolean seen(long id) {
    boolean[] v = new boolean[1];
    cleanupInTenant(
        1L,
        () ->
            v[0] =
                dsl.select(EMAIL_MESSAGE.SEEN)
                    .from(EMAIL_MESSAGE)
                    .where(EMAIL_MESSAGE.ID.eq(id))
                    .fetchOne(EMAIL_MESSAGE.SEEN));
    return v[0];
  }

  /** 첫 적재가 서버 \Flagged 를 읽고, 이후 동기화가 다른 앱에서 켜고 끈 별표를 반영한다. */
  @Test
  void readsFlagged_onInsertAndResync() throws Exception {
    seedAndFirstSync();
    long a = idOf("메일 A");
    long b = idOf("메일 B");
    assertThat(flagged(a)).isTrue();
    assertThat(flagged(b)).isFalse();

    MailTestPorts.setServerFlagged("메일 A", false);
    MailTestPorts.setServerFlagged("메일 B", true);
    sync();

    assertThat(flagged(a)).isFalse();
    assertThat(flagged(b)).isTrue();
  }

  /**
   * 최근 범위(14일) 밖이라도 로컬에 별표가 켜진 메일은 다시 읽는다 — 다른 앱에서 끈 별표가 반영된다. 범위 밖·별표 없는 메일은 재조회하지 않는다(알려진 한계).
   */
  @Test
  void oldLocallyFlaggedMail_isReread() throws Exception {
    seedAndFirstSync();
    long a = idOf("메일 A");
    long b = idOf("메일 B");
    // 두 메일 모두 30일 전에 받은 것으로 — 최근 재조회 범위 밖
    cleanupInTenant(
        1L,
        () ->
            dsl.update(EMAIL_MESSAGE)
                .set(EMAIL_MESSAGE.RECEIVED_AT, OffsetDateTime.now().minusDays(30))
                .where(EMAIL_MESSAGE.ID.in(a, b))
                .execute());

    MailTestPorts.setServerFlagged("메일 A", false);
    MailTestPorts.setServerFlagged("메일 B", true);
    sync();

    assertThat(flagged(a)).isFalse(); // 로컬 별표였던 옛 메일 — 재조회로 해제 반영
    assertThat(flagged(b)).isFalse(); // 범위 밖·로컬 별표 없음 — 재조회 대상 아님
  }

  /** 읽음 반영 대기 메일도 서버 별표는 들어오고(읽음은 덮지 않음), 별표 반영 대기 메일도 서버 읽음은 들어온다(별표는 덮지 않음). */
  @Test
  void pendingAttribute_notOverwritten_otherAttributeStillSynced() throws Exception {
    seedAndFirstSync();
    long a = idOf("메일 A");
    long b = idOf("메일 B");
    cleanupInTenant(
        1L,
        () -> {
          messageRepo.markSeen(b); // B: 로컬 읽음 — 읽음 반영 대기(서버는 아직 안읽음)
          messageRepo.markFlagged(a, false); // A: 로컬 별표 해제 — 별표 반영 대기(서버는 아직 별표)
        });
    MailTestPorts.setServerFlagged("메일 B", true); // 서버: B 별표
    MailTestPorts.setServerSeen("메일 A", true); // 서버: A 읽음

    sync();

    assertThat(seen(b)).isTrue(); // 읽음 대기 — 서버 안읽음으로 되돌리지 않음
    assertThat(flagged(b)).isTrue(); // 별표는 서버를 따른다
    assertThat(flagged(a)).isFalse(); // 별표 대기 — 서버 별표로 되돌리지 않음
    assertThat(seen(a)).isTrue(); // 읽음은 서버를 따른다
  }
}
