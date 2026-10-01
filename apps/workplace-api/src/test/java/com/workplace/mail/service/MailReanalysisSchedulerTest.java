package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.mail.dto.AiAccountRef;
import com.workplace.mail.repository.EmailAccountRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import java.util.stream.LongStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** WP-151 재분석 스케줄러 단위 — tick 겹침 방지(실행 중이면 건너뜀), 실행기 거절 시 복구, 실행당 선점 계정 상한. */
class MailReanalysisSchedulerTest {

  private final TenantScopedRunner tenantRunner = mock(TenantScopedRunner.class);
  private final EmailAccountRepository accountRepo = mock(EmailAccountRepository.class);
  private final MailReanalysisService reanalysis = mock(MailReanalysisService.class);
  private final List<Runnable> submitted = new ArrayList<>();

  @BeforeEach
  @SuppressWarnings("unchecked")
  void tenantOne() {
    // 테넌트 1 하나만 도는 것처럼 콜백을 즉시 실행
    doAnswer(
            inv -> {
              ((Consumer<Long>) inv.getArgument(0)).accept(1L);
              return null;
            })
        .when(tenantRunner)
        .forEachActiveTenant(any());
  }

  private MailReanalysisScheduler scheduler() {
    return new MailReanalysisScheduler(tenantRunner, accountRepo, reanalysis, submitted::add);
  }

  @Test
  void tick_skipsWhileRunning() {
    MailReanalysisScheduler s = scheduler();
    when(accountRepo.listAiEnabledAccountsBelowClassifyVersion(anyInt())).thenReturn(List.of());

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
    MailReanalysisScheduler s =
        new MailReanalysisScheduler(
            tenantRunner,
            accountRepo,
            reanalysis,
            r -> {
              attempts.incrementAndGet();
              throw new RejectedExecutionException("full");
            });

    s.tick();
    s.tick(); // 거절된 뒤에도 겹침 표시가 풀려 다음 tick 이 다시 넘긴다(예외는 밖으로 새지 않음)

    assertThat(attempts).hasValue(2);
  }

  @Test
  void runPendingNow_capsClaimedAccountsPerRun() {
    List<AiAccountRef> refs =
        LongStream.rangeClosed(1, MailReanalysisScheduler.MAX_ACCOUNTS_PER_RUN + 5)
            .mapToObj(i -> new AiAccountRef(100 + i, i))
            .toList();
    when(accountRepo.listAiEnabledAccountsBelowClassifyVersion(anyInt())).thenReturn(refs);
    when(reanalysis.reanalyzeAccountNow(anyLong(), anyLong())).thenReturn(true);

    scheduler().runPendingNow();

    verify(reanalysis, times(MailReanalysisScheduler.MAX_ACCOUNTS_PER_RUN))
        .reanalyzeAccountNow(anyLong(), anyLong());
  }

  @Test
  void runPendingNow_unclaimedAccountsDoNotCountTowardCap() {
    List<AiAccountRef> refs =
        LongStream.rangeClosed(1, MailReanalysisScheduler.MAX_ACCOUNTS_PER_RUN + 5)
            .mapToObj(i -> new AiAccountRef(100 + i, i))
            .toList();
    when(accountRepo.listAiEnabledAccountsBelowClassifyVersion(anyInt())).thenReturn(refs);
    when(reanalysis.reanalyzeAccountNow(anyLong(), anyLong())).thenReturn(false); // 비서 없음 등

    scheduler().runPendingNow();

    verify(reanalysis, times(refs.size())).reanalyzeAccountNow(anyLong(), anyLong());
  }

  @Test
  void tick_runFailure_isSwallowed_andNextTickSubmitsAgain() {
    doThrow(new IllegalStateException("db down")).when(tenantRunner).forEachActiveTenant(any());
    MailReanalysisScheduler s = scheduler();

    s.tick();
    submitted.get(0).run(); // 수집 단계 실패 — 예외가 밖으로 새지 않고 겹침 표시가 풀린다
    s.tick();

    assertThat(submitted).hasSize(2);
  }
}
