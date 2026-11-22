package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.MailSyncStatus;
import com.workplace.mail.repository.MailAccountJobRepository;
import com.workplace.mail.repository.MailAccountJobRepository.Kind;
import com.workplace.mail.service.MailJobHeartbeat;
import com.workplace.mail.service.MailJobRun;
import com.workplace.mail.service.MailSyncProgress;
import com.workplace.mail.service.trash.MailTrashEmptyProgress;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * MailSyncProgress(DB 기반) 통합 테스트(WP-1977) — 가드·생애주기·인스턴스 간 공유·만료 인수·실행 핸들로 한정된 쓰기·전용 하트비트.
 *
 * <p>스프링 빈의 하트비트는 30초마다 돌아 updated_at 을 되돌리는 테스트와 엇갈릴 수 있어, 각 테스트는 시작하지 않은(주기 실행 없는) 하트비트로 만든 진행
 * 인스턴스를 쓰고 하트비트는 {@link MailJobHeartbeat#beat()} 로 직접 돌린다.
 */
class MailSyncProgressTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;

  @Autowired private MailAccountJobRepository repo;
  @Autowired private PlatformTransactionManager txManager;
  @Autowired private DSLContext dsl;

  private long accountId;

  /** 이 테스트의 하트비트(주기 실행 없음) — beat() 로 직접 돌린다. */
  private MailJobHeartbeat hb;

  /** 이 테스트의 진행 인스턴스(hb 를 쓴다). */
  private MailSyncProgress p;

  /** 계정을 시드하고 주기 실행 없는 하트비트·진행 인스턴스를 만든다. */
  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
    accountId =
        callInTenant(
            TENANT_ID,
            () -> TestFixtures.seedMailbox(dsl, "prog-" + System.nanoTime() + "@example.com")[1]);
    hb = new MailJobHeartbeat(repo, txManager);
    p = fresh(hb);
  }

  /** 시드한 계정(작업 행은 CASCADE)을 지우고 테넌트 문맥을 비운다. */
  @AfterEach
  void tearDown() {
    cleanupInTenant(
        TENANT_ID,
        () -> dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(accountId)).execute());
    TenantContext.clear();
  }

  /** 주어진 하트비트를 쓰는 진행 인스턴스(다른 파드 흉내에도 쓴다). */
  private MailSyncProgress fresh(MailJobHeartbeat heartbeat) {
    return new MailSyncProgress(repo, new TransactionTemplate(txManager), heartbeat);
  }

  /** 선점에 반드시 성공해야 하는 준비 단계 — 실행 핸들을 돌려준다. */
  private MailJobRun start(MailSyncProgress q) {
    return q.tryStart(accountId).orElseThrow();
  }

  /** 선점·진행·끝내기 한 바퀴 — 진행 중 두 번째 선점은 막히고, 끝낸 뒤에는 IDLE(수 유지)이며 다시 선점된다. */
  @Test
  void guardAndLifecycle() {
    MailJobRun run = start(p);
    assertThat(p.tryStart(accountId)).isEmpty();
    assertThat(hb.holds(run)).isTrue();

    MailSyncStatus s1 = p.snapshot(accountId);
    assertThat(s1.phase()).isEqualTo("LIST");
    assertThat(s1.running()).isTrue();

    p.startBodies(run, 3);
    p.incBody(run);
    MailSyncStatus s2 = p.snapshot(accountId);
    assertThat(s2.phase()).isEqualTo("BODIES");
    assertThat(s2.total()).isEqualTo(3);
    assertThat(s2.done()).isEqualTo(1);
    assertThat(s2.running()).isTrue();

    p.finish(run);
    assertThat(hb.holds(run)).isFalse();
    MailSyncStatus s3 = p.snapshot(accountId);
    assertThat(s3.phase()).isEqualTo("IDLE");
    assertThat(s3.running()).isFalse();
    assertThat(s3.total()).isEqualTo(3);
    assertThat(s3.done()).isEqualTo(1);
    assertThat(p.tryStart(accountId)).isPresent();
  }

  /** 행이 없는 계정은 IDLE. */
  @Test
  void snapshot_unknownAccount_isIdle() {
    MailSyncStatus s = p.snapshot(999_999_999L);
    assertThat(s.phase()).isEqualTo("IDLE");
    assertThat(s.running()).isFalse();
  }

  /** 두 인스턴스(두 파드 흉내)가 가드·진행을 공유한다. */
  @Test
  void twoInstances_shareGuardAndProgress() {
    MailSyncProgress a = fresh(new MailJobHeartbeat(repo, txManager));
    MailSyncProgress b = fresh(new MailJobHeartbeat(repo, txManager));
    MailJobRun run = start(a);
    assertThat(b.tryStart(accountId)).isEmpty();
    a.startBodies(run, 3);
    a.incBody(run);
    MailSyncStatus s = b.snapshot(accountId);
    assertThat(s.phase()).isEqualTo("BODIES");
    assertThat(s.total()).isEqualTo(3);
    assertThat(s.done()).isEqualTo(1);
    assertThat(s.running()).isTrue();
  }

  /**
   * 테넌트 문맥 없는 스레드(백필 워커 등)에서도 핸들에 저장된 테넌트로 진행 쓰기·끝내기가 적용된다 — RUNNING 이 TTL 까지 남지 않는다(WP-1977 리뷰 지적
   * 3).
   */
  @Test
  void writesWithoutTenantContext_useRunTenant() {
    MailJobRun run = start(p);
    TenantContext.clear();
    assertThatCode(
            () -> {
              p.startBodies(run, 2);
              p.incBody(run);
              p.finish(run);
            })
        .doesNotThrowAnyException();
    TenantContext.set(TENANT_ID);
    MailSyncStatus s = p.snapshot(accountId);
    assertThat(s.running()).isFalse();
    assertThat(s.total()).isEqualTo(2);
    assertThat(s.done()).isEqualTo(1);
  }

  /** 핸들에도 호출자에도 테넌트가 없으면 쓰기를 건너뛴다(예외 없음, 행은 RUNNING → TTL 만료). */
  @Test
  void writesWithoutAnyTenant_skipped() {
    MailJobRun started = start(p);
    MailJobRun noTenant = new MailJobRun(Kind.SYNC, accountId, started.runId(), null);
    TenantContext.clear();
    assertThatCode(() -> p.finish(noTenant)).doesNotThrowAnyException();
    TenantContext.set(TENANT_ID);
    assertThat(p.snapshot(accountId).running()).isTrue();
  }

  /** 저장소 쓰기가 실패해도 startBodies/incBody/finish 는 예외를 전파하지 않는다(쓰기는 실제로 시도된다). */
  @Test
  void failingRepositoryWrites_doNotPropagate() {
    MailAccountJobRepository failing = mock(MailAccountJobRepository.class);
    UUID runId = UUID.randomUUID();
    when(failing.tryStart(any(), anyLong(), any(), any())).thenReturn(Optional.of(runId));
    doThrow(new RuntimeException("db down"))
        .when(failing)
        .setPhaseTotal(any(), anyLong(), any(), any(), anyInt());
    doThrow(new RuntimeException("db down"))
        .when(failing)
        .addDone(any(), anyLong(), any(), anyInt());
    doThrow(new RuntimeException("db down")).when(failing).finish(any(), anyLong(), any());
    MailSyncProgress q =
        new MailSyncProgress(
            failing, new TransactionTemplate(txManager), new MailJobHeartbeat(failing, txManager));
    MailJobRun run = start(q);
    assertThatCode(
            () -> {
              q.startBodies(run, 3);
              q.incBody(run);
              q.finish(run);
            })
        .doesNotThrowAnyException();
    // 실패를 삼킨 것이지 쓰기를 건너뛴 것이 아니다 — 핸들의 실행 토큰으로 실제로 불렀는지 확인한다.
    verify(failing).setPhaseTotal(Kind.SYNC, accountId, runId, "BODIES", 3);
    verify(failing).addDone(Kind.SYNC, accountId, runId, 1);
    verify(failing).finish(Kind.SYNC, accountId, runId);
  }

  /** 하트비트가 쥔 실행의 updated_at 을 갱신해 만료를 늦춘다. 끝낸 뒤에는 하트비트 대상에서 빠진다. */
  @Test
  void heartbeat_refreshesHeldRun() {
    MailJobRun run = start(p);
    // TTL(2분)+1분 전으로 되돌려 하트비트 없으면 만료일 상태를 만든다.
    ageUpdatedAt(3);
    assertThat(p.snapshot(accountId).running()).isFalse();
    // 하트비트 스레드처럼 테넌트 문맥 없이 부른다 — 핸들이 기억한 테넌트로 문맥을 세운다.
    TenantContext.clear();
    hb.beat();
    TenantContext.set(TENANT_ID);
    assertThat(p.snapshot(accountId).running()).isTrue();
    assertThat(p.tryStart(accountId)).isEmpty();

    p.finish(run);
    assertThat(hb.holds(run)).isFalse();
  }

  /** 다른 파드가 만료 행을 다시 선점하면 옛 실행의 하트비트는 0행이라 대상에서 빠지고, 옛 핸들의 늦은 쓰기는 새 실행을 덮지 않는다. */
  @Test
  void heartbeat_afterTakeover_dropsHeldRun() {
    MailJobHeartbeat hbA = new MailJobHeartbeat(repo, txManager);
    MailSyncProgress a = fresh(hbA);
    MailSyncProgress b = fresh(new MailJobHeartbeat(repo, txManager));
    MailJobRun old = start(a);
    ageUpdatedAt(3);
    start(b);
    hbA.beat();
    assertThat(hbA.holds(old)).isFalse();
    a.startBodies(old, 9);
    assertThat(b.snapshot(accountId).phase()).isEqualTo("LIST");
  }

  /**
   * 같은 파드(같은 인스턴스)에서 만료된 옛 실행 뒤 다시 선점해도, 옛 핸들의 진행 쓰기·끝내기는 새 실행을 건드리지 않고 새 실행은 하트비트 대상에 남는다(WP-1977
   * 리뷰 지적 1 — 계정 id 로 토큰을 찾던 방식은 옛 실행이 새 토큰으로 끝낼 수 있었다).
   */
  @Test
  void samePodRetake_oldHandleCannotTouchNewRun() {
    MailJobRun old = start(p);
    ageUpdatedAt(3);
    MailJobRun retaken = start(p);
    assertThat(retaken.runId()).isNotEqualTo(old.runId());

    p.startBodies(old, 9);
    p.incBody(old);
    p.finish(old);

    MailSyncStatus s = p.snapshot(accountId);
    assertThat(s.running()).isTrue();
    assertThat(s.phase()).isEqualTo("LIST");
    assertThat(s.done()).isZero();
    assertThat(hb.holds(retaken)).isTrue();
    assertThat(hb.holds(old)).isFalse();

    p.finish(retaken);
    assertThat(p.snapshot(accountId).running()).isFalse();
  }

  /** discard 는 진행 행을 지우고 그 계정의 실행을 하트비트 대상에서 뺀다(테스트·복구용 정리). */
  @Test
  void discard_deletesRowAndDropsRuns() {
    MailJobRun run = start(p);
    p.discardForTest(accountId);
    assertThat(hb.holds(run)).isFalse();
    assertThat(p.snapshot(accountId).phase()).isEqualTo("IDLE");
    assertThat(p.tryStart(accountId)).isPresent();
  }

  /**
   * 쥔 실행 여럿(동기화·휴지통 비우기)이 테넌트별 UPDATE 한 번으로 함께 갱신되고, 그새 다른 run_id 로 넘어간 행은 건드리지 않는다(WP-1977 리뷰 후속 —
   * 실행마다 트랜잭션을 열던 것을 묶었다).
   */
  @Test
  void heartbeat_batchesHeldRuns_andSkipsOtherRunId() {
    MailAccountJobRepository spyRepo = spy(new MailAccountJobRepository(dsl));
    MailJobHeartbeat shared = new MailJobHeartbeat(spyRepo, txManager);
    MailSyncProgress sync =
        new MailSyncProgress(spyRepo, new TransactionTemplate(txManager), shared);
    MailTrashEmptyProgress trash =
        new MailTrashEmptyProgress(spyRepo, new TransactionTemplate(txManager), shared);
    long other = seedAccount();
    try {
      MailJobRun s = sync.tryStart(accountId).orElseThrow();
      MailJobRun t = trash.tryStart(accountId).orElseThrow();
      MailJobRun o = sync.tryStart(other).orElseThrow();
      // 세 행 모두 만료 직전 상태로 되돌리고, 동기화 행 하나는 다른 실행에 넘어간 것처럼 run_id 만 바꾼다(updated_at 은 그대로 오래됨).
      ageUpdatedAt(3);
      ageUpdatedAt(other, 3);
      callInTenant(
          TENANT_ID,
          () ->
              dsl.execute(
                  "update mail_account_job set run_id = ? where account_id = ? and kind = 'SYNC'",
                  UUID.randomUUID(),
                  accountId));

      // 하트비트 스레드처럼 문맥 없이 돌린다 — beat 가 던져도 이후 정리가 문맥을 잃지 않게 finally 로 되돌린다.
      TenantContext.clear();
      try {
        shared.beat();
      } finally {
        TenantContext.set(TENANT_ID);
      }

      // 한 테넌트의 실행 셋이 한 번의 묶음 갱신으로 처리됐다(실행별 단건 갱신은 쓰지 않는다).
      verify(spyRepo, times(1)).heartbeatAll(anyCollection());
      assertThat(trash.snapshot(accountId).state()).isEqualTo("RUNNING");
      assertThat(sync.snapshot(other).running()).isTrue();
      // run_id 가 다른 행은 갱신되지 않아 여전히 만료 상태이고, 그 핸들은 쥔 목록에서 빠진다.
      assertThat(sync.snapshot(accountId).running()).isFalse();
      assertThat(shared.holds(s)).isFalse();
      assertThat(shared.holds(t)).isTrue();
      assertThat(shared.holds(o)).isTrue();
    } finally {
      cleanupInTenant(
          TENANT_ID,
          () -> dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(other)).execute());
    }
  }

  /**
   * 본문 진행 25건은 1건마다 쓰지 않고 묶어 쓴다(첫 건 즉시·20건 묶음·남은 4건은 finish 때) — finish 뒤 done 은 정확히 25. total(30)에
   * 닿지 않아 마지막 건 쓰기는 일어나지 않는다(보충이 대상보다 적게 처리한 경우).
   */
  @Test
  void incBody_batchesWrites_andFinishFlushesRest() {
    MailAccountJobRepository spyRepo = spy(new MailAccountJobRepository(dsl));
    // 시계를 멈춰 시간 조건이 끼어들지 않게 한다 — 건수 조건만 본다.
    MailSyncProgress q =
        new MailSyncProgress(
            spyRepo,
            new TransactionTemplate(txManager),
            new MailJobHeartbeat(spyRepo, txManager),
            () -> 0L);
    MailJobRun run = start(q);
    q.startBodies(run, 30);
    for (int i = 0; i < 25; i++) {
      q.incBody(run);
    }
    verify(spyRepo, times(2)).addDone(eq(Kind.SYNC), eq(accountId), eq(run.runId()), anyInt());
    assertThat(q.snapshot(accountId).done()).isEqualTo(21);

    q.finish(run);
    verify(spyRepo).addDone(Kind.SYNC, accountId, run.runId(), 4);
    verify(spyRepo, times(3)).addDone(eq(Kind.SYNC), eq(accountId), eq(run.runId()), anyInt());
    assertThat(q.snapshot(accountId).done()).isEqualTo(25);
    assertThat(q.snapshot(accountId).running()).isFalse();
  }

  /** 마지막 건(total 도달)은 묶음을 기다리지 않고 바로 써 진행바가 끝나기 전에 total/total 을 보인다. */
  @Test
  void incBody_flushesOnLastItem() {
    MailSyncProgress q =
        new MailSyncProgress(
            repo,
            new TransactionTemplate(txManager),
            new MailJobHeartbeat(repo, txManager),
            () -> 0L);
    MailJobRun run = start(q);
    q.startBodies(run, 3);
    q.incBody(run); // 첫 건은 즉시
    q.incBody(run);
    assertThat(q.snapshot(accountId).done()).isEqualTo(1);
    q.incBody(run); // 마지막 건 — finish 전에 3/3
    assertThat(q.snapshot(accountId).done()).isEqualTo(3);
    assertThat(q.snapshot(accountId).running()).isTrue();
  }

  /** 건수가 적어도 마지막 쓰기 뒤 2초가 지나면 다음 incBody 때 쌓인 만큼 쓴다. */
  @Test
  void incBody_flushesAfterInterval() {
    AtomicLong now = new AtomicLong();
    MailSyncProgress q =
        new MailSyncProgress(
            repo,
            new TransactionTemplate(txManager),
            new MailJobHeartbeat(repo, txManager),
            now::get);
    MailJobRun run = start(q);
    q.startBodies(run, 10);
    q.incBody(run); // 첫 건은 즉시
    q.incBody(run);
    q.incBody(run);
    assertThat(q.snapshot(accountId).done()).isEqualTo(1);
    now.addAndGet(Duration.ofSeconds(3).toNanos());
    q.incBody(run);
    assertThat(q.snapshot(accountId).done()).isEqualTo(4);
  }

  /** 본문 진행은 실행 핸들별로 쌓여 다른 계정의 실행과 섞이지 않는다. */
  @Test
  void incBody_pendingIsPerRun() {
    MailSyncProgress q =
        new MailSyncProgress(
            repo,
            new TransactionTemplate(txManager),
            new MailJobHeartbeat(repo, txManager),
            () -> 0L);
    long other = seedAccount();
    try {
      MailJobRun a = start(q);
      MailJobRun b = q.tryStart(other).orElseThrow();
      q.startBodies(a, 10);
      q.startBodies(b, 10);
      for (int i = 0; i < 5; i++) {
        q.incBody(a);
      }
      for (int i = 0; i < 3; i++) {
        q.incBody(b);
      }
      q.finish(a);
      q.finish(b);
      assertThat(q.snapshot(accountId).done()).isEqualTo(5);
      assertThat(q.snapshot(other).done()).isEqualTo(3);
    } finally {
      cleanupInTenant(
          TENANT_ID,
          () -> dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(other)).execute());
    }
  }

  /** 테넌트#1 에 메일 계정을 하나 더 시드한다(여러 실행을 다루는 테스트용). */
  private long seedAccount() {
    return callInTenant(
        TENANT_ID,
        () -> TestFixtures.seedMailbox(dsl, "prog2-" + System.nanoTime() + "@example.com")[1]);
  }

  /** 주어진 계정의 작업 행 updated_at 을 분 단위로 과거로 되돌린다. */
  private void ageUpdatedAt(long account, int minutes) {
    callInTenant(
        TENANT_ID,
        () ->
            dsl.execute(
                "update mail_account_job set updated_at = now() - make_interval(mins => ?)"
                    + " where account_id = ?",
                minutes,
                account));
  }

  /** updated_at 을 지금보다 분 단위로 과거로 되돌린다(하트비트·쓰기가 끊긴 실행 흉내). */
  private void ageUpdatedAt(int minutes) {
    callInTenant(
        TENANT_ID,
        () ->
            dsl.execute(
                "update mail_account_job set updated_at = now() - make_interval(mins => ?)"
                    + " where account_id = ?",
                minutes,
                accountId));
  }

  /** TTL 이 지난 RUNNING 은 IDLE 로 보이고 다시 선점된다. */
  @Test
  void expiredRunning_snapshotIdle_andRestartable() {
    start(p);
    // TTL(2분)을 넘겨 되돌려 죽은 작업(만료)을 흉내낸다.
    ageUpdatedAt(3);
    MailSyncStatus s = p.snapshot(accountId);
    assertThat(s.phase()).isEqualTo("IDLE");
    assertThat(s.running()).isFalse();
    assertThat(p.tryStart(accountId)).isPresent();
  }
}
