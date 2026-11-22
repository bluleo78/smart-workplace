package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.MailAccountJobRepository;
import com.workplace.mail.repository.MailAccountJobRepository.Job;
import com.workplace.mail.repository.MailAccountJobRepository.Kind;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * MailAccountJobRepository 통합 테스트(WP-1977).
 *
 * <p>선점(tryStart)·만료 인수·종료 뒤 갱신 무시·실행 토큰(run_id) 불일치 쓰기 무시·하트비트·단계 전환 시 done 리셋·실패 시 잔여 계산·종류별
 * 독립·테넌트 격리·계정 삭제 CASCADE 를 검증한다. 동시성 검증을 위해 커밋되는 트랜잭션으로 실행하고, 끝나면 시드한 계정(작업 행은 CASCADE)을 지운다.
 */
class MailAccountJobRepositoryTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;
  private static final Duration TTL = Duration.ofMinutes(10);

  @Autowired private MailAccountJobRepository repo;
  @Autowired private DSLContext dsl;

  private long accountId;

  /** 테넌트 문맥을 세우고 계정을 시드한다. */
  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
    accountId = seedAccount();
  }

  /** 시드한 계정(작업 행은 CASCADE)을 지우고 문맥을 비운다. */
  @AfterEach
  void tearDown() {
    cleanupInTenant(
        TENANT_ID,
        () -> dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(accountId)).execute());
    TenantContext.clear();
  }

  /** 테넌트#1 에 메일 계정 하나를 커밋해 시드하고 accountId 를 돌려준다. */
  private long seedAccount() {
    return callInTenant(
        TENANT_ID,
        () -> TestFixtures.seedMailbox(dsl, "job-" + System.nanoTime() + "@example.com")[1]);
  }

  /** 이 계정의 kind 작업 행을 조회한다 — 없으면 실패(준비가 행을 만들었어야 한다). */
  private Job find(Kind kind) {
    return callInTenant(TENANT_ID, () -> repo.find(kind, accountId, TTL).orElseThrow());
  }

  /** 선점을 시도하고 실행 토큰을 돌려준다(실패하면 empty). */
  private Optional<UUID> start(Kind kind) {
    return callInTenant(TENANT_ID, () -> repo.tryStart(kind, accountId, "LIST", TTL));
  }

  /** 선점에 성공했는지만 본다. */
  private boolean tryStart(Kind kind) {
    return start(kind).isPresent();
  }

  /** 반드시 선점해야 하는 준비 단계 — 실행 토큰을 돌려준다. */
  private UUID startOrFail(Kind kind) {
    return start(kind).orElseThrow();
  }

  /** updated_at 을 지금보다 분 단위로 과거로 되돌린다(죽은 작업·오래된 갱신 흉내). */
  private void ageUpdatedAt(int minutes) {
    callInTenant(
        TENANT_ID,
        () ->
            dsl.execute(
                "UPDATE mail_account_job SET updated_at = now() - make_interval(mins => ?)"
                    + " WHERE account_id = ?",
                minutes,
                accountId));
  }

  /** 진행 중이면 두 번째 선점은 실패하고, 끝낸 뒤에는 다시 선점된다. */
  @Test
  void tryStart_secondCallFalse_untilFinish() {
    UUID run = startOrFail(Kind.SYNC);
    assertThat(tryStart(Kind.SYNC)).isFalse();
    callInTenant(
        TENANT_ID,
        () -> {
          repo.finish(Kind.SYNC, accountId, run);
          return null;
        });
    assertThat(find(Kind.SYNC).state()).isEqualTo("DONE");
    assertThat(find(Kind.SYNC).finishedAt()).isNotNull();
    assertThat(tryStart(Kind.SYNC)).isTrue();
  }

  /** 여러 스레드가 동시에 선점해도 원자적 upsert 덕분에 하나만 이긴다. */
  @Test
  void tryStart_concurrent_onlyOneWins() throws Exception {
    int n = 8;
    ExecutorService pool = Executors.newFixedThreadPool(n);
    CountDownLatch go = new CountDownLatch(1);
    try {
      List<Future<Boolean>> futures = new ArrayList<>();
      for (int i = 0; i < n; i++) {
        futures.add(
            pool.submit(
                () -> {
                  go.await();
                  // 각 스레드는 자기 ThreadLocal 에 테넌트 문맥을 세운다.
                  return tryStart(Kind.SYNC);
                }));
      }
      go.countDown();
      int wins = 0;
      for (Future<Boolean> f : futures) {
        if (f.get(10, TimeUnit.SECONDS)) wins++;
      }
      assertThat(wins).isEqualTo(1);
    } finally {
      pool.shutdownNow();
    }
  }

  /** TTL 이 지난 RUNNING 은 다른 실행이 다시 선점하고, 새 토큰을 받는다. 옛 실행의 늦은 쓰기는 새 실행을 덮어쓰지 못한다. */
  @Test
  void tryStart_expiredRunning_takesOver() {
    UUID old = startOrFail(Kind.SYNC);
    callInTenant(
        TENANT_ID,
        () -> {
          repo.setPhaseTotal(Kind.SYNC, accountId, old, "FETCH", 10);
          repo.addDone(Kind.SYNC, accountId, old, 4);
          return null;
        });
    // updated_at 을 ttl + 1분 전으로 되돌려 죽은 작업을 흉내낸다.
    ageUpdatedAt(11);
    assertThat(find(Kind.SYNC).expired()).isTrue();
    UUID taken = startOrFail(Kind.SYNC);
    assertThat(taken).isNotEqualTo(old);
    Job j = find(Kind.SYNC);
    assertThat(j.state()).isEqualTo("RUNNING");
    assertThat(j.done()).isZero();
    assertThat(j.total()).isNull();
    assertThat(j.phase()).isEqualTo("LIST");
    assertThat(j.expired()).isFalse();

    // 실은 느렸을 뿐인 옛 실행이 늦게 쓰거나 끝내도 새 실행의 행은 그대로다.
    callInTenant(
        TENANT_ID,
        () -> {
          repo.addDone(Kind.SYNC, accountId, old, 3);
          repo.finish(Kind.SYNC, accountId, old);
          assertThat(repo.heartbeat(Kind.SYNC, accountId, old)).isFalse();
          return null;
        });
    Job after = find(Kind.SYNC);
    assertThat(after.state()).isEqualTo("RUNNING");
    assertThat(after.done()).isZero();
  }

  /** run_id 가 다르면 모든 쓰기(setPhaseTotal·setTotal·addDone·addFailed·finish·fail)가 무시된다. */
  @Test
  void writes_withOtherRunId_ignored() {
    startOrFail(Kind.TRASH_EMPTY);
    UUID stranger = UUID.randomUUID();
    callInTenant(
        TENANT_ID,
        () -> {
          repo.setPhaseTotal(Kind.TRASH_EMPTY, accountId, stranger, "X", 9);
          repo.setTotal(Kind.TRASH_EMPTY, accountId, stranger, 9);
          repo.addDone(Kind.TRASH_EMPTY, accountId, stranger, 3);
          repo.addFailed(Kind.TRASH_EMPTY, accountId, stranger, 2);
          repo.finish(Kind.TRASH_EMPTY, accountId, stranger);
          repo.fail(Kind.TRASH_EMPTY, accountId, stranger, "IMAP_ERROR");
          return null;
        });
    Job j = find(Kind.TRASH_EMPTY);
    assertThat(j.state()).isEqualTo("RUNNING");
    assertThat(j.phase()).isEqualTo("LIST");
    assertThat(j.total()).isNull();
    assertThat(j.done()).isZero();
    assertThat(j.failed()).isZero();
    assertThat(j.errorCode()).isNull();
  }

  /** 하트비트가 updated_at 을 갱신해, 진행 쓰기가 없어도 만료되지 않는다(다른 실행이 선점하지 못한다). */
  @Test
  void heartbeat_keepsRunningAlive() {
    UUID run = startOrFail(Kind.SYNC);
    Duration minute = Duration.ofMinutes(1);
    // 마지막 갱신이 9분 전인 것처럼 되돌린다 — 1분 TTL 로 보면 만료, 10분 TTL 로는 아직 살아 있다.
    ageUpdatedAt(9);
    assertThat(callInTenant(TENANT_ID, () -> repo.find(Kind.SYNC, accountId, minute)))
        .get()
        .extracting(Job::expired)
        .isEqualTo(true);
    assertThat(callInTenant(TENANT_ID, () -> repo.heartbeat(Kind.SYNC, accountId, run))).isTrue();
    // 하트비트가 updated_at 을 지금으로 당겨 1분 TTL 로 봐도 만료가 아니다.
    assertThat(callInTenant(TENANT_ID, () -> repo.find(Kind.SYNC, accountId, minute)))
        .get()
        .extracting(Job::expired)
        .isEqualTo(false);
    Job j = find(Kind.SYNC);
    assertThat(j.expired()).isFalse();
    assertThat(j.state()).isEqualTo("RUNNING");
    assertThat(tryStart(Kind.SYNC)).isFalse();
  }

  /** 끝난 실행에는 하트비트가 적용되지 않는다(행을 RUNNING 으로 되살리지 않는다). */
  @Test
  void heartbeat_afterFinish_returnsFalse() {
    UUID run = startOrFail(Kind.SYNC);
    callInTenant(
        TENANT_ID,
        () -> {
          repo.finish(Kind.SYNC, accountId, run);
          assertThat(repo.heartbeat(Kind.SYNC, accountId, run)).isFalse();
          return null;
        });
    assertThat(find(Kind.SYNC).state()).isEqualTo("DONE");
  }

  /** setPhaseTotal 로 단계를 바꾸면 done 이 0 으로 돌아간다(failed 는 유지). */
  @Test
  void setPhaseTotal_resetsDone() {
    UUID run = startOrFail(Kind.SYNC);
    callInTenant(
        TENANT_ID,
        () -> {
          repo.setPhaseTotal(Kind.SYNC, accountId, run, "LIST", 5);
          repo.addDone(Kind.SYNC, accountId, run, 4);
          repo.addFailed(Kind.SYNC, accountId, run, 1);
          repo.setPhaseTotal(Kind.SYNC, accountId, run, "BODIES", 3);
          return null;
        });
    Job j = find(Kind.SYNC);
    assertThat(j.phase()).isEqualTo("BODIES");
    assertThat(j.total()).isEqualTo(3);
    assertThat(j.done()).isZero();
    assertThat(j.failed()).isEqualTo(1);
  }

  /** 실패로 끝내면 total 대비 남은 수가 실패로 채워진다. */
  @Test
  void fail_fillsRemainingAsFailed() {
    UUID run = startOrFail(Kind.TRASH_EMPTY);
    callInTenant(
        TENANT_ID,
        () -> {
          repo.setTotal(Kind.TRASH_EMPTY, accountId, run, 5);
          repo.addDone(Kind.TRASH_EMPTY, accountId, run, 2);
          repo.addFailed(Kind.TRASH_EMPTY, accountId, run, 1);
          repo.fail(Kind.TRASH_EMPTY, accountId, run, "IMAP_ERROR");
          return null;
        });
    Job j = find(Kind.TRASH_EMPTY);
    assertThat(j.state()).isEqualTo("FAILED");
    assertThat(j.failed()).isEqualTo(3);
    assertThat(j.done()).isEqualTo(2);
    assertThat(j.errorCode()).isEqualTo("IMAP_ERROR");
    assertThat(j.finishedAt()).isNotNull();
  }

  /** deleteRun 은 실행 토큰이 일치하는 RUNNING 행만 지운다(다시 선점된 새 실행은 옛 토큰으로 지우지 못한다). */
  @Test
  void deleteRun_onlyMatchingRun() {
    UUID run = startOrFail(Kind.TRASH_EMPTY);
    callInTenant(
        TENANT_ID,
        () -> {
          repo.deleteRun(Kind.TRASH_EMPTY, accountId, UUID.randomUUID());
          return null;
        });
    assertThat(find(Kind.TRASH_EMPTY).state()).isEqualTo("RUNNING");
    callInTenant(
        TENANT_ID,
        () -> {
          repo.deleteRun(Kind.TRASH_EMPTY, accountId, run);
          return null;
        });
    assertThat(callInTenant(TENANT_ID, () -> repo.find(Kind.TRASH_EMPTY, accountId, TTL)))
        .isEmpty();
  }

  /** 같은 계정이라도 작업 종류가 다르면 따로 선점된다. */
  @Test
  void kindsIndependent() {
    assertThat(tryStart(Kind.SYNC)).isTrue();
    assertThat(tryStart(Kind.TRASH_EMPTY)).isTrue();
  }

  /** 다른 테넌트 문맥에서는 RLS 로 행을 보지도 바꾸지도 못한다. */
  @Test
  void otherTenant_cannotSeeOrTouch() {
    UUID run = startOrFail(Kind.SYNC);
    long other = ensureFixtureTenant("wp1977-other-tenant");
    callInTenant(
        other,
        () -> {
          assertThat(repo.find(Kind.SYNC, accountId, TTL)).isEmpty();
          repo.addDone(Kind.SYNC, accountId, run, 7);
          repo.finish(Kind.SYNC, accountId, run);
          assertThat(repo.heartbeat(Kind.SYNC, accountId, run)).isFalse();
          repo.delete(Kind.SYNC, accountId);
          return null;
        });
    Job j = find(Kind.SYNC);
    assertThat(j.state()).isEqualTo("RUNNING");
    assertThat(j.done()).isZero();
  }

  /** 계정을 지우면 작업 행도 CASCADE 로 지워진다. */
  @Test
  void accountDelete_cascades() {
    tryStart(Kind.SYNC);
    cleanupInTenant(
        TENANT_ID,
        () -> dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(accountId)).execute());
    assertThat(callInTenant(TENANT_ID, () -> repo.find(Kind.SYNC, accountId, TTL))).isEmpty();
  }
}
