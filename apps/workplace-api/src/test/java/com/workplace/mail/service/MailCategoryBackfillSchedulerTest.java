package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.airun.AiCallTimeouts;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAccountRepository.ActiveAccount;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.stream.LongStream;
import net.javacrumbs.shedlock.core.DefaultLockingTaskExecutor;
import net.javacrumbs.shedlock.core.LockConfiguration;
import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.core.LockingTaskExecutor;
import net.javacrumbs.shedlock.core.SimpleLock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

/**
 * WP-185 분류 일괄 스케줄러 단위 — tick 겹침 방지·실행기 거절 복구·파드 간 잠금(잡으면 실행, 못 잡으면 건너뜀). 회차 상한·guard 중단·테넌트 컨텍스트는
 * {@link MailCategoryBackfillSchedulerIT} 가 실제 DB 로 검증한다.
 */
class MailCategoryBackfillSchedulerTest {

  private final TenantScopedRunner tenantRunner = mock(TenantScopedRunner.class);
  private final EmailAccountRepository accountRepo = mock(EmailAccountRepository.class);
  private final MailCategoryBackfillService service = mock(MailCategoryBackfillService.class);
  private final List<Runnable> submitted = new ArrayList<>();

  @BeforeEach
  @SuppressWarnings("unchecked")
  void tenantOne() {
    // 테넌트 1 하나만 도는 것처럼 콜백을 즉시 실행, 활성 계정 1개
    doAnswer(
            inv -> {
              ((Consumer<Long>) inv.getArgument(0)).accept(1L);
              return null;
            })
        .when(tenantRunner)
        .forEachActiveTenant(any());
    when(accountRepo.findActiveForSync()).thenReturn(List.of(new ActiveAccount(11L, 101L)));
  }

  private MailCategoryBackfillScheduler scheduler(LockProvider lockProvider) {
    return new MailCategoryBackfillScheduler(
        tenantRunner,
        accountRepo,
        service,
        submitted::add,
        lockProvider == null ? null : new DefaultLockingTaskExecutor(lockProvider));
  }

  @Test
  void tick_skipsWhileRunning() {
    MailCategoryBackfillScheduler s = scheduler(null);

    s.tick();
    s.tick(); // 첫 실행이 아직 실행기 안에 있음 → 건너뜀
    assertThat(submitted).hasSize(1);

    submitted.get(0).run(); // 실행 완료 → 겹침 표시 해제
    s.tick();
    assertThat(submitted).hasSize(2);
  }

  @Test
  void tick_rejected_resetsGuard() {
    AtomicInteger attempts = new AtomicInteger();
    MailCategoryBackfillScheduler s =
        new MailCategoryBackfillScheduler(
            tenantRunner,
            accountRepo,
            service,
            r -> {
              attempts.incrementAndGet();
              throw new RejectedExecutionException("full");
            },
            (LockingTaskExecutor) null);

    s.tick();
    s.tick(); // 거절된 뒤에도 겹침 표시가 풀려 다음 tick 이 다시 넘긴다(예외는 밖으로 새지 않음)

    assertThat(attempts).hasValue(2);
  }

  @Test
  void tick_runFailure_isSwallowed_andNextTickSubmitsAgain() {
    doThrow(new IllegalStateException("db down")).when(tenantRunner).forEachActiveTenant(any());
    MailCategoryBackfillScheduler s = scheduler(null);

    s.tick();
    submitted.get(0).run(); // 수집 단계 실패 — 예외가 밖으로 새지 않고 겹침 표시가 풀린다
    s.tick();

    assertThat(submitted).hasSize(2);
  }

  /** 서비스가 예외를 던져도(방어 경로) 예산을 추측해 깎지 않고 다음 계정으로 계속한다 — 10 계정 모두 닿는다. */
  @Test
  void throwingAccounts_areSwallowed_andRoundContinuesWithoutCharge() {
    when(accountRepo.findActiveForSync())
        .thenReturn(
            LongStream.rangeClosed(1, 10).mapToObj(i -> new ActiveAccount(i, 100 + i)).toList());
    when(service.classifyAccountNow(anyLong(), anyLong(), any(), anyInt()))
        .thenThrow(new IllegalStateException("save failed"));

    scheduler(null).runOnceNow();

    verify(service, times(10)).classifyAccountNow(anyLong(), anyLong(), any(), anyInt());
  }

  @Test
  void lockAcquired_runsRoundInsideLock_andReleases() {
    LockProvider lockProvider = mock(LockProvider.class);
    SimpleLock lock = mock(SimpleLock.class);
    when(lockProvider.lock(any())).thenReturn(Optional.of(lock));
    MailCategoryBackfillScheduler s = scheduler(lockProvider);

    s.tick();
    submitted.get(0).run();

    ArgumentCaptor<LockConfiguration> cfg = ArgumentCaptor.forClass(LockConfiguration.class);
    verify(lockProvider).lock(cfg.capture());
    assertThat(cfg.getValue().getName()).isEqualTo(MailCategoryBackfillScheduler.LOCK_NAME);
    assertThat(cfg.getValue().getLockAtMostFor()).hasMinutes(30);
    // 회차(분류 호출)가 끝난 뒤에 잠금을 푼다 — 실행 구간 전체를 잠근다
    InOrder order = inOrder(service, lock);
    // 시간 예산: 잠금 30분 − 여유 2분 = 28분 ÷ 호출 최악(120+30초) = 11 — 개수 상한 20 보다 작아 11 을 넘긴다(WP-2111)
    order.verify(service).classifyAccountNow(eq(101L), eq(11L), any(), eq(11));
    order.verify(lock).unlock();
  }

  @Test
  void lockHeldByOtherPod_skipsRound() {
    LockProvider lockProvider = mock(LockProvider.class);
    when(lockProvider.lock(any())).thenReturn(Optional.empty());
    MailCategoryBackfillScheduler s = scheduler(lockProvider);

    s.tick();
    submitted.get(0).run();

    verify(tenantRunner, never()).forEachActiveTenant(any());
    verify(service, never()).classifyAccountNow(anyLong(), anyLong(), any(), anyInt());
    s.tick(); // 건너뛴 뒤에도 겹침 표시가 풀린다
    assertThat(submitted).hasSize(2);
  }

  /**
   * WP-2111: 회차 시간 예산 — 계정마다 「남은 시간 ÷ 호출 최악(120+30초)」만큼만 넘기고, 남은 시간이 호출 하나도 못 담으면 다음 계정에 보내지 않는다.
   */
  @Test
  void timeBudget_passesOnlyCallsThatFit_andStopsWhenNoneFits() {
    when(accountRepo.findActiveForSync())
        .thenReturn(
            LongStream.rangeClosed(1, 3).mapToObj(i -> new ActiveAccount(i, 100 + i)).toList());
    MutableClock clock = new MutableClock(Instant.parse("2026-11-25T00:00:00Z"));
    List<Integer> passed = new ArrayList<>();
    when(service.classifyAccountNow(anyLong(), anyLong(), any(), anyInt()))
        .thenAnswer(
            inv -> {
              passed.add(inv.getArgument(3));
              // 첫 계정이 25분, 둘째가 1분 걸린 것처럼 — 셋째 앞에서 남은 시간은 2분(120초) < 150초
              clock.advance(passed.size() == 1 ? Duration.ofMinutes(25) : Duration.ofMinutes(1));
              return 1;
            });

    new MailCategoryBackfillScheduler(
            tenantRunner,
            accountRepo,
            service,
            submitted::add,
            null,
            AiCallTimeouts.defaults(),
            clock)
        .runOnceNow();

    // 첫 계정: 28분 ÷ 150초 = 11, 둘째: 남은 3분 ÷ 150초 = 1, 셋째: 남은 2분 → 보내지 않음
    assertThat(passed).containsExactly(11, 1);
  }

  /** 테스트가 앞으로 돌리는 시계(UTC). */
  private static final class MutableClock extends Clock {
    private final AtomicReference<Instant> now;

    MutableClock(Instant start) {
      this.now = new AtomicReference<>(start);
    }

    void advance(Duration d) {
      now.updateAndGet(i -> i.plus(d));
    }

    @Override
    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
      return this;
    }

    @Override
    public Instant instant() {
      return now.get();
    }
  }
}
