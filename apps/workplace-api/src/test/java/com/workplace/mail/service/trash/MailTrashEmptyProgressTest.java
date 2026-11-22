package com.workplace.mail.service.trash;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.MailTrashEmptyStatus;
import com.workplace.mail.repository.MailAccountJobRepository;
import com.workplace.mail.repository.MailAccountJobRepository.Kind;
import com.workplace.mail.service.MailJobHeartbeat;
import com.workplace.mail.service.MailJobRun;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 휴지통 비우기 진행 상태(WP-1682, DB 보관 WP-1977) 통합 테스트 — 계정당 하나만 돌고(RUNNING 이면 다시 시작하지 않는다), 중간에 멈추면 남은 메일을
 * 실패로 세어 {@code deleted + failed = total} 을 맞추며, 끝난 뒤 다시 시작하면 0 부터 센다. 인스턴스가 둘이어도 상태를 공유하고, 만료된
 * RUNNING 은 IDLE 이다. 쓰기는 실행 핸들로 한정되고 하트비트는 전용 스케줄러가 한다.
 *
 * <p>스프링 빈의 하트비트(30초 주기)가 updated_at 을 되돌리는 테스트와 엇갈리지 않게, 각 테스트는 주기 실행 없는 하트비트로 만든 진행 인스턴스를 쓰고
 * {@link MailJobHeartbeat#beat()} 를 직접 부른다.
 */
class MailTrashEmptyProgressTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;

  @Autowired private MailAccountJobRepository repo;
  @Autowired private PlatformTransactionManager txManager;
  @Autowired private DSLContext dsl;

  private long accountId;

  /** 이 테스트의 하트비트(주기 실행 없음). */
  private MailJobHeartbeat hb;

  /** 이 테스트의 진행 인스턴스(hb 를 쓴다). */
  private MailTrashEmptyProgress p;

  /** 계정을 시드하고 주기 실행 없는 하트비트·진행 인스턴스를 만든다. */
  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
    accountId =
        callInTenant(
            TENANT_ID,
            () ->
                TestFixtures.seedMailbox(dsl, "trash-prog-" + System.nanoTime() + "@example.com")[
                    1]);
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
  private MailTrashEmptyProgress fresh(MailJobHeartbeat heartbeat) {
    return new MailTrashEmptyProgress(repo, new TransactionTemplate(txManager), heartbeat);
  }

  /** 선점에 반드시 성공해야 하는 준비 단계 — 실행 핸들을 돌려준다. */
  private MailJobRun start(MailTrashEmptyProgress q) {
    return q.tryStart(accountId).orElseThrow();
  }

  /** 시작·진행·실패 뒤 남은 수가 실패로 채워지고, 다시 시작하면 0 부터 센다. */
  @Test
  void lifecycle() {
    assertThat(p.snapshot(accountId).state()).isEqualTo("IDLE");
    MailJobRun run = start(p);
    assertThat(p.tryStart(accountId)).isEmpty();
    MailTrashEmptyStatus running = p.snapshot(accountId);
    assertThat(running.state()).isEqualTo("RUNNING");
    assertThat(running.total()).isNull(); // 스냅샷 전
    assertThat(running.startedAt()).isNotNull();

    p.setTotal(run, 5);
    p.addDeleted(run, 2);
    p.addFailed(run, 1);
    p.fail(run, "SERVER_UNREACHABLE");
    assertThat(hb.holds(run)).isFalse();

    MailTrashEmptyStatus s = p.snapshot(accountId);
    assertThat(s.state()).isEqualTo("FAILED");
    assertThat(s.total()).isEqualTo(5);
    assertThat(s.deleted()).isEqualTo(2);
    assertThat(s.deleted() + s.failed()).isEqualTo(5); // 남은 2통은 실패로
    assertThat(s.errorCode()).isEqualTo("SERVER_UNREACHABLE");
    assertThat(s.error()).isEqualTo("메일 서버에 연결하지 못했습니다");
    assertThat(s.finishedAt()).isNotNull();

    assertThat(p.tryStart(accountId)).isPresent(); // 끝난 뒤 다시 시작하면 0 부터
    MailTrashEmptyStatus again = p.snapshot(accountId);
    assertThat(again.state()).isEqualTo("RUNNING");
    assertThat(again.deleted()).isZero();
    assertThat(again.failed()).isZero();
    assertThat(again.total()).isNull();
    assertThat(again.errorCode()).isNull();
    assertThat(again.finishedAt()).isNull();
  }

  /** 끝까지 돌면 DONE 이고 수가 유지된다. 다른 계정은 IDLE 그대로. */
  @Test
  void finish_isDone_keepsCounts_otherAccountsUntouched() {
    MailJobRun run = start(p);
    p.setTotal(run, 3);
    p.addDeleted(run, 2);
    p.addFailed(run, 1);
    p.finish(run);

    MailTrashEmptyStatus s = p.snapshot(accountId);
    assertThat(s.state()).isEqualTo("DONE");
    assertThat(s.deleted()).isEqualTo(2);
    assertThat(s.failed()).isEqualTo(1);
    assertThat(s.finishedAt()).isNotNull();
    assertThat(s.errorCode()).isNull();
    assertThat(p.snapshot(999_999_999L).state()).isEqualTo("IDLE");
  }

  /** 수를 세기 전에 멈추면 total 은 모르는 채(null)로 남는다. */
  @Test
  void failBeforeSnapshot_keepsTotalUnknown() {
    MailJobRun run = start(p);
    p.fail(run, "TRASH_CHANGED");

    MailTrashEmptyStatus s = p.snapshot(accountId);
    assertThat(s.state()).isEqualTo("FAILED");
    assertThat(s.total()).isNull();
    assertThat(s.failed()).isZero();
  }

  /** 되돌리면 IDLE 로 돌아가고 하트비트 대상에서 빠지며 다시 시작할 수 있다. */
  @Test
  void release_returnsToIdle() {
    MailJobRun run = start(p);
    p.release(run);
    assertThat(hb.holds(run)).isFalse();

    MailTrashEmptyStatus s = p.snapshot(accountId);
    assertThat(s.state()).isEqualTo("IDLE");
    assertThat(s.total()).isNull();
    assertThat(s.deleted()).isZero();
    assertThat(s.failed()).isZero();
    assertThat(s.startedAt()).isNull();
    assertThat(s.finishedAt()).isNull();
    assertThat(s.errorCode()).isNull();
    assertThat(s.error()).isNull();
    assertThat(p.tryStart(accountId)).isPresent();
  }

  /** 옛 핸들의 되돌림은 그새 다시 선점된 새 실행의 행을 지우지 않는다. */
  @Test
  void release_withOldHandle_keepsNewRun() {
    MailJobRun old = start(p);
    ageUpdatedAt(3);
    MailJobRun retaken = start(p);
    p.release(old);
    assertThat(p.snapshot(accountId).state()).isEqualTo("RUNNING");
    assertThat(hb.holds(retaken)).isTrue();
  }

  /** 두 인스턴스(두 파드 흉내)가 상태를 공유한다. */
  @Test
  void twoInstances_shareState() {
    MailTrashEmptyProgress a = fresh(new MailJobHeartbeat(repo, txManager));
    MailTrashEmptyProgress b = fresh(new MailJobHeartbeat(repo, txManager));
    MailJobRun run = start(a);
    a.setTotal(run, 5);
    a.addDeleted(run, 2);
    MailTrashEmptyStatus s = b.snapshot(accountId);
    assertThat(s.state()).isEqualTo("RUNNING");
    assertThat(s.total()).isEqualTo(5);
    assertThat(s.deleted()).isEqualTo(2);
    assertThat(b.tryStart(accountId)).isEmpty();
  }

  /** TTL 이 지난 RUNNING 은 IDLE 로 보이고 다시 시작할 수 있다. */
  @Test
  void expiredRunning_snapshotIdle_andRestartable() {
    start(p);
    // TTL(2분)을 넘겨 되돌려 죽은 작업(만료)을 흉내낸다.
    ageUpdatedAt(3);
    assertThat(p.snapshot(accountId).state()).isEqualTo("IDLE");
    assertThat(p.tryStart(accountId)).isPresent();
  }

  /** 테넌트 문맥 없는 작업 스레드에서도 핸들에 저장된 테넌트로 진행 쓰기·끝내기가 적용된다(WP-1977 리뷰 지적 3). */
  @Test
  void writesWithoutTenantContext_useRunTenant() {
    MailJobRun run = start(p);
    TenantContext.clear();
    assertThatCode(
            () -> {
              p.setTotal(run, 2);
              p.addDeleted(run, 1);
              p.addFailed(run, 1);
              p.finish(run);
            })
        .doesNotThrowAnyException();
    TenantContext.set(TENANT_ID);
    MailTrashEmptyStatus s = p.snapshot(accountId);
    assertThat(s.state()).isEqualTo("DONE");
    assertThat(s.total()).isEqualTo(2);
    assertThat(s.deleted()).isEqualTo(1);
    assertThat(s.failed()).isEqualTo(1);
  }

  /** 핸들에도 호출자에도 테넌트가 없으면 쓰기를 건너뛴다(예외 없음, 행은 RUNNING → TTL 만료). */
  @Test
  void writesWithoutAnyTenant_skipped() {
    MailJobRun started = start(p);
    MailJobRun noTenant = new MailJobRun(Kind.TRASH_EMPTY, accountId, started.runId(), null);
    TenantContext.clear();
    assertThatCode(
            () -> {
              p.setTotal(noTenant, 2);
              p.fail(noTenant, "TRASH_CHANGED");
            })
        .doesNotThrowAnyException();
    TenantContext.set(TENANT_ID);
    assertThat(p.snapshot(accountId).state()).isEqualTo("RUNNING");
  }

  /** 저장소 쓰기가 실패해도 진행 쓰기는 예외를 전파하지 않는다(작업 스레드는 던지면 안 된다). 쓰기는 실제로 시도된다. */
  @Test
  void failingRepositoryWrites_doNotPropagate() {
    MailAccountJobRepository failing = mock(MailAccountJobRepository.class);
    UUID runId = UUID.randomUUID();
    when(failing.tryStart(any(), anyLong(), any(), any())).thenReturn(Optional.of(runId));
    RuntimeException boom = new RuntimeException("db down");
    doThrow(boom).when(failing).setTotal(any(), anyLong(), any(), anyInt());
    doThrow(boom).when(failing).addDone(any(), anyLong(), any(), anyInt());
    doThrow(boom).when(failing).addFailed(any(), anyLong(), any(), anyInt());
    doThrow(boom).when(failing).finish(any(), anyLong(), any());
    doThrow(boom).when(failing).fail(any(), anyLong(), any(), anyString());
    MailTrashEmptyProgress q =
        new MailTrashEmptyProgress(
            failing, new TransactionTemplate(txManager), new MailJobHeartbeat(failing, txManager));
    MailJobRun run = start(q);
    assertThatCode(
            () -> {
              q.setTotal(run, 3);
              q.addDeleted(run, 1);
              q.addFailed(run, 1);
              q.finish(run);
              q.fail(run, "TRASH_CHANGED");
            })
        .doesNotThrowAnyException();
    // 실패를 삼킨 것이지 쓰기를 건너뛴 것이 아니다 — 핸들의 실행 토큰으로 실제로 불렀는지 확인한다.
    verify(failing).setTotal(Kind.TRASH_EMPTY, accountId, runId, 3);
    verify(failing).addDone(Kind.TRASH_EMPTY, accountId, runId, 1);
    verify(failing).addFailed(Kind.TRASH_EMPTY, accountId, runId, 1);
    verify(failing).finish(Kind.TRASH_EMPTY, accountId, runId);
    verify(failing).fail(Kind.TRASH_EMPTY, accountId, runId, "TRASH_CHANGED");
  }

  /** 하트비트가 쥔 실행의 updated_at 을 갱신해 만료를 늦춘다. 끝낸 뒤에는 대상에서 빠진다. */
  @Test
  void heartbeat_refreshesHeldRun() {
    MailJobRun run = start(p);
    assertThat(hb.holds(run)).isTrue();
    // TTL(2분)+1분 전으로 되돌려 하트비트 없으면 만료일 상태를 만든다.
    ageUpdatedAt(3);
    assertThat(p.snapshot(accountId).state()).isEqualTo("IDLE");
    // 하트비트 스레드처럼 테넌트 문맥 없이 부른다 — 핸들이 기억한 테넌트로 문맥을 세운다.
    TenantContext.clear();
    hb.beat();
    TenantContext.set(TENANT_ID);
    assertThat(p.snapshot(accountId).state()).isEqualTo("RUNNING");
    assertThat(p.tryStart(accountId)).isEmpty();

    p.fail(run, "TRASH_CHANGED");
    assertThat(hb.holds(run)).isFalse();
  }

  /** 다른 파드가 만료 행을 다시 선점하면 옛 실행의 쓰기는 무시되고, 하트비트는 0행이라 대상에서 빠진다. */
  @Test
  void takeover_oldRunCannotOverwrite() {
    MailJobHeartbeat hbA = new MailJobHeartbeat(repo, txManager);
    MailTrashEmptyProgress a = fresh(hbA);
    MailTrashEmptyProgress b = fresh(new MailJobHeartbeat(repo, txManager));
    MailJobRun old = start(a);
    ageUpdatedAt(3);
    MailJobRun taken = start(b);
    // 옛 실행(a)이 하트비트 전에 늦게 쓴다 — 토큰이 달라 새 실행(b)의 행은 그대로다.
    a.setTotal(old, 9);
    a.addDeleted(old, 4);
    a.finish(old);
    MailTrashEmptyStatus s = b.snapshot(accountId);
    assertThat(s.state()).isEqualTo("RUNNING");
    assertThat(s.total()).isNull();
    assertThat(s.deleted()).isZero();

    assertThat(a.tryStart(accountId)).isEmpty();
    b.setTotal(taken, 2);
    assertThat(b.snapshot(accountId).total()).isEqualTo(2);
  }

  /** 같은 파드에서 재선점한 뒤 옛 핸들의 쓰기·끝내기는 새 실행을 건드리지 않는다(WP-1977 리뷰 지적 1). */
  @Test
  void samePodRetake_oldHandleCannotTouchNewRun() {
    MailJobRun old = start(p);
    ageUpdatedAt(3);
    MailJobRun retaken = start(p);

    p.setTotal(old, 9);
    p.addDeleted(old, 4);
    p.fail(old, "TRASH_CHANGED");

    MailTrashEmptyStatus s = p.snapshot(accountId);
    assertThat(s.state()).isEqualTo("RUNNING");
    assertThat(s.total()).isNull();
    assertThat(s.deleted()).isZero();
    assertThat(hb.holds(retaken)).isTrue();

    p.setTotal(retaken, 2);
    p.finish(retaken);
    assertThat(p.snapshot(accountId).state()).isEqualTo("DONE");
    assertThat(p.snapshot(accountId).total()).isEqualTo(2);
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
}
