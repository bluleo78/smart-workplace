package com.workplace.mail.service;

import com.workplace.global.outbound.AgentOutageGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAccountRepository.ActiveAccount;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.core.ClockProvider;
import net.javacrumbs.shedlock.core.DefaultLockingTaskExecutor;
import net.javacrumbs.shedlock.core.LockConfiguration;
import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.core.LockingTaskExecutor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 받은편지함 전체 메일 카테고리 일괄 분류 스케줄러(WP-185) — 10분마다 모든 활성 계정에 {@link
 * MailCategoryBackfillService#classifyAccountNow} 를 돌려 미분류 메일을 채운다.
 *
 * <ul>
 *   <li><b>전용 실행기</b>: tick 은 {@code mailCategoryBackfillExecutor}(단일 스레드)에 넘기기만 한다. 스프링 스케줄러 스레드는
 *       하나뿐이고 자동 동기화(3분)·선제 요약·GC·purge 가 함께 쓰므로 LLM 루프로 잡으면 다른 작업이 밀린다. 동기화 직후
 *       {@code @Async}(aiAgentEventExecutor) 로도 돌리지 않는다 — 채팅 AI 디스패치와 공유하는 실행기라 고갈·거절이 생긴다. 실행 중이면
 *       그 tick 은 건너뛴다(running 플래그).
 *   <li><b>회차 상한</b>: 회차 전체 묶음 호출은 최대 {@value #MAX_BATCHES_PER_ROUND}회(≤500통). 계정당 상한({@link
 *       MailCategoryBackfillService#MAX_BATCHES})과 별개로, 남은 예산을 서비스에 넘기고 돌려받은 호출 수만큼 깎는다. 최악(20 ×
 *       60초 타임아웃 = 20분)도 잠금 lockAtMostFor(30분) 안에 끝난다. 나머지 계정은 다음 회차에.
 *   <li><b>agent 불가</b>: 회차당 {@link AgentOutageGuard} 하나를 모든 계정이 공유하고, 멈춤이 되면 남은 계정을 건너뛴다.
 *   <li><b>파드 간 중복 방지</b>: 실행기 안에서 ShedLock {@link LockingTaskExecutor} 로 회차 전체를 감싼다. tick 에
 *       {@code @SchedulerLock} 을 붙이면 넘기자마자 잠금이 풀려 실제 실행 동안 다른 파드를 막지 못한다(WP-165, {@link
 *       MailReanalysisScheduler} 참고). 이 작업은 재분석처럼 계정 단위 선점이 없어 두 파드가 같은 미분류 메일을 동시에 LLM 에 보내므로, 실제
 *       실행 구간을 잠근다. 잠금을 못 잡은 파드는 그 회차를 건너뛴다. {@code workplace.scheduling.lock-enabled=false}(테스트
 *       프로파일)라 LockProvider 빈이 없으면 잠금 없이 실행한다.
 *   <li>① {@link TenantScopedRunner} 로 테넌트별 짧은 트랜잭션(GUC)에서 대상 계정만 모으고, ② 트랜잭션 밖에서 계정마다
 *       TenantContext 를 주입해 분류한다(#232 — LLM 이 DB 커넥션을 오래 잡지 않게).
 * </ul>
 *
 * <p>켜고 끄기는 다른 스케줄러와 같다 — {@code workplace.scheduling.enabled=false}(WP-80)면 @Scheduled 자체가 등록되지
 * 않는다.
 */
@Slf4j
@Component
public class MailCategoryBackfillScheduler {

  /** 회차 전체 묶음 호출 상한 — 25통 × 20 = 500통, 최악 20분(잠금 30분 안). */
  static final int MAX_BATCHES_PER_ROUND = 20;

  /** ShedLock 작업 이름 — shedlock 테이블의 행 키. */
  static final String LOCK_NAME = "mailCategoryBackfill";

  /** 잠금 최대 유지 — 잡은 파드가 죽어도 이 시간 뒤 풀린다. 회차 최악 소요(20분)보다 길게. */
  private static final Duration LOCK_AT_MOST = Duration.ofMinutes(30);

  /** 잠금 최소 유지 — 거의 동시에 깬 다른 파드가 막 끝난 회차를 바로 다시 돌지 않게(SchedulerLockConfig 기본값과 같다). */
  private static final Duration LOCK_AT_LEAST = Duration.ofSeconds(10);

  /** 수집 단계 산출 — 어느 테넌트의 어느 사용자/계정인지. */
  private record Target(long tenantId, long userId, long accountId) {}

  private final TenantScopedRunner tenantRunner;
  private final EmailAccountRepository accountRepo;
  private final MailCategoryBackfillService categoryBackfill;
  private final Executor executor;

  /** 파드 간 잠금 — LockProvider 빈이 없으면(잠금 꺼짐) null 이고 잠금 없이 실행한다. */
  private final LockingTaskExecutor lockingExecutor;

  /** 실행 중 표시 — 이전 회차가 끝나기 전에 다음 tick 이 겹쳐 들어가지 않게 한다. */
  private final AtomicBoolean running = new AtomicBoolean(false);

  @Autowired
  public MailCategoryBackfillScheduler(
      TenantScopedRunner tenantRunner,
      EmailAccountRepository accountRepo,
      MailCategoryBackfillService categoryBackfill,
      @Qualifier("mailCategoryBackfillExecutor") Executor executor,
      ObjectProvider<LockProvider> lockProvider) {
    this(
        tenantRunner,
        accountRepo,
        categoryBackfill,
        executor,
        lockProvider.stream().findFirst().map(DefaultLockingTaskExecutor::new).orElse(null));
  }

  /** 단위 테스트용 — 실행기와 잠금 실행기(없으면 null)를 직접 넣는다. */
  MailCategoryBackfillScheduler(
      TenantScopedRunner tenantRunner,
      EmailAccountRepository accountRepo,
      MailCategoryBackfillService categoryBackfill,
      Executor executor,
      LockingTaskExecutor lockingExecutor) {
    this.tenantRunner = tenantRunner;
    this.accountRepo = accountRepo;
    this.categoryBackfill = categoryBackfill;
    this.executor = executor;
    this.lockingExecutor = lockingExecutor;
  }

  /** 주기 트리거 — 전용 실행기에 넘기기만 하고 바로 돌아온다. 실행 중이면 건너뛴다. 부팅 3분 뒤 첫 실행(재분석 2분과 엇갈리게), 이후 10분 간격. */
  @Scheduled(initialDelay = 180_000, fixedDelay = 600_000)
  void tick() {
    if (!running.compareAndSet(false, true)) {
      log.debug("분류 일괄 실행 중 — 이번 주기 건너뜀");
      return;
    }
    try {
      executor.execute(
          () -> {
            try {
              runLocked();
            } catch (RuntimeException e) {
              // 수집 단계 실패(DB·테넌트 순회 등)가 조용히 사라지지 않게 남긴다 — 다음 주기에 다시 시도
              log.warn("분류 일괄 실행 실패 — 다음 주기에 재시도: {}", e.toString());
            } finally {
              running.set(false);
            }
          });
    } catch (RejectedExecutionException e) {
      running.set(false); // 넘기지 못했으면 다음 tick 이 다시 시도하도록 표시를 푼다
      log.warn("분류 일괄 실행기 거절 — 다음 주기에 재시도: {}", e.toString());
    }
  }

  /** 실행기 안 — 파드 간 잠금을 잡은 경우에만 회차를 돈다(못 잡으면 ShedLock 이 조용히 건너뛴다). 잠금이 꺼져 있으면 바로 돈다. */
  private void runLocked() {
    if (lockingExecutor == null) {
      runOnceNow();
      return;
    }
    lockingExecutor.executeWithLock(
        (Runnable) this::runOnceNow,
        new LockConfiguration(ClockProvider.now(), LOCK_NAME, LOCK_AT_MOST, LOCK_AT_LEAST));
  }

  /** 동기 본체(잠금 없음) — 테스트는 이 메서드를 직접 호출한다. 계정별 실패는 삼키고 다음 계정으로. */
  public void runOnceNow() {
    // ① 수집: 테넌트별 짧은 트랜잭션(GUC 주입) 안에서 모든 활성 계정을 모은다. 비서 해석(공통 → AI 사용 계정의 개인)은 서비스가 계정별로 한다.
    List<Target> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          for (ActiveAccount a : accountRepo.findActiveForSync()) {
            targets.add(new Target(tenantId, a.userId(), a.accountId()));
          }
        });
    // ② 실행: 트랜잭션 밖. TenantContext 만 주입(서비스 내부 TransactionTemplate 이 GUC 주입).
    AgentOutageGuard guard = new AgentOutageGuard();
    int budget = MAX_BATCHES_PER_ROUND;
    for (int i = 0; i < targets.size(); i++) {
      if (guard.tripped()) {
        log.warn("분류 일괄 회차 중단 — ai-agent 불가, 남은 계정 {}개는 다음 주기", targets.size() - i);
        return;
      }
      if (budget <= 0) {
        log.info("분류 일괄 회차 상한 도달 — 남은 계정 {}개는 다음 주기", targets.size() - i);
        return;
      }
      Target t = targets.get(i);
      TenantContext.set(t.tenantId());
      try {
        budget -= categoryBackfill.classifyAccountNow(t.userId(), t.accountId(), guard, budget);
      } catch (RuntimeException e) {
        // 예외로 끝나면 실제 호출 수를 모른다(묶음 호출 뒤 저장·다음 대상 조회에서 던졌을 수 있음). 회차 상한이 깨지지 않게 이 계정이 쓸 수
        // 있었던 최대치를 깎는다 — 실패 경로라 과다 차감은 감수한다.
        budget -= Math.min(budget, MailCategoryBackfillService.MAX_BATCHES);
        log.warn("분류 일괄 실패 tenant={} account={}", t.tenantId(), t.accountId(), e);
      } finally {
        TenantContext.clear();
      }
    }
  }
}
