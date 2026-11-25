package com.workplace.mail.service;

import com.workplace.airun.AiCallTimeouts;
import com.workplace.airun.RoundDeadline;
import com.workplace.global.config.SchedulerLockConfig;
import com.workplace.global.outbound.AgentOutageGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.mail.outbound.MailAiConfig;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAccountRepository.ActiveAccount;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
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
 *   <li><b>전용 실행기</b>: tick 은 {@code mailCategoryBackfillExecutor}(단일 스레드)에 넘기기만 한다. 스프링 스케줄러 공용
 *       스레드(4개, WP-211)는 자동 동기화(3분)·선제 요약·GC·purge 가 함께 쓰므로 LLM 루프로 잡으면 다른 작업이 밀린다. 동기화 직후
 *       {@code @Async}(aiAgentEventExecutor) 로도 돌리지 않는다 — 채팅 AI 디스패치와 공유하는 실행기라 고갈·거절이 생긴다. 실행 중이면
 *       그 tick 은 건너뛴다(running 플래그).
 *   <li><b>회차 상한</b>: 회차 전체 묶음 호출은 최대 {@value #MAX_BATCHES_PER_ROUND}회(≤500통). 계정당 상한({@link
 *       MailCategoryBackfillService#MAX_BATCHES})과 별개로, 남은 예산을 서비스에 넘기고 돌려받은 호출 수만큼 깎는다. 호출 상한(기본
 *       120초, 덮어쓰기 가능)이 올라 개수만으로는 최악(20 × (120+30)초 = 50분)이 잠금(30분)을 넘으므로, 시간 예산({@link
 *       RoundDeadline}, 잠금 − 2분)도 둔다 — 계정마다 「남은 시간 ÷ 호출 최악(메일 클라이언트 읽기 상한)」만큼만 넘겨, 다음 호출을 시작하기 전에
 *       마감을 넘을 호출은 보내지 않는다(WP-2111). 나머지 계정은 다음 회차에.
 *   <li><b>공평성</b>: 백로그가 있는 계정은 한 회차에 최대 4묶음씩 쓰므로 예산 20 이 5개 계정에서 바닥난다. 대상은 (tenantId, accountId) 로
 *       정렬하고 시작 위치를 회차마다 한 칸씩 돌려, 초기 백로그를 비우는 동안에도 뒤쪽 계정이 굶지 않게 한다(회차당 약 5개 계정씩 돌아가며). 백로그가 없는 계정은
 *       예산을 0 만 쓰므로 초기 드레인이 끝나면 모든 계정이 매 회차 닿는다(새 메일은 약 한 주기 안에 분류).
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

  /** 회차 전체 묶음 호출 상한(비용 상한) — 25통 × 20 = 500통. 시간은 따로 {@link RoundDeadline} 이 묶는다. */
  static final int MAX_BATCHES_PER_ROUND = 20;

  /** ShedLock 작업 이름 — shedlock 테이블의 행 키. */
  static final String LOCK_NAME = "mailCategoryBackfill";

  /** 잠금 최대 유지 — 잡은 파드가 죽어도 이 시간 뒤 풀린다. 회차는 이 값 − 2분 마감({@link RoundDeadline})으로 끊는다. */
  private static final Duration LOCK_AT_MOST =
      Duration.parse(SchedulerLockConfig.DEFAULT_LOCK_AT_MOST_FOR);

  /** 잠금 최소 유지 — 거의 동시에 깬 다른 파드가 막 끝난 회차를 바로 다시 돌지 않게(SchedulerLockConfig 기본값과 같다). */
  private static final Duration LOCK_AT_LEAST = Duration.ofSeconds(10);

  /** 수집 단계 산출 — 어느 테넌트의 어느 사용자/계정인지. */
  private record Target(long tenantId, long userId, long accountId) {}

  private final TenantScopedRunner tenantRunner;
  private final EmailAccountRepository accountRepo;
  private final MailCategoryBackfillService categoryBackfill;
  private final Executor executor;

  /** AI 호출 실행 상한 표(WP-2111) — 묶음 호출 하나의 최악 시간을 계산한다. */
  private final AiCallTimeouts timeouts;

  /** 회차 시간 예산의 시계 — 테스트가 경과 시간을 정한다. */
  private final Clock clock;

  /** 파드 간 잠금 — LockProvider 빈이 없으면(잠금 꺼짐) null 이고 잠금 없이 실행한다. */
  private final LockingTaskExecutor lockingExecutor;

  /**
   * 회차 시작 위치 회전 카운터 — 회차 예산(20)이 앞쪽 백로그 큰 계정들에 먼저 소진돼 뒤 계정이 굶지 않게, 정렬된 대상의 시작 인덱스를 회차마다 한 칸씩 민다.
   * 싱글톤 빈이고 회차는 단일 스레드 실행기 + running 플래그로 직렬이라 일반 필드로 충분하다(다른 파드와는 공유하지 않는다 — 파드별로 독립 회전해도 무방).
   */
  private int rotation = 0;

  /** 실행 중 표시 — 이전 회차가 끝나기 전에 다음 tick 이 겹쳐 들어가지 않게 한다. */
  private final AtomicBoolean running = new AtomicBoolean(false);

  @Autowired
  public MailCategoryBackfillScheduler(
      TenantScopedRunner tenantRunner,
      EmailAccountRepository accountRepo,
      MailCategoryBackfillService categoryBackfill,
      @Qualifier("mailCategoryBackfillExecutor") Executor executor,
      ObjectProvider<LockProvider> lockProvider,
      AiCallTimeouts timeouts) {
    this(
        tenantRunner,
        accountRepo,
        categoryBackfill,
        executor,
        lockProvider.stream().findFirst().map(DefaultLockingTaskExecutor::new).orElse(null),
        timeouts,
        Clock.systemUTC());
  }

  /** 단위 테스트용 — 실행기와 잠금 실행기(없으면 null)를 직접 넣는다. 상한 표는 기본값, 시계는 시스템 시계. */
  MailCategoryBackfillScheduler(
      TenantScopedRunner tenantRunner,
      EmailAccountRepository accountRepo,
      MailCategoryBackfillService categoryBackfill,
      Executor executor,
      LockingTaskExecutor lockingExecutor) {
    this(
        tenantRunner,
        accountRepo,
        categoryBackfill,
        executor,
        lockingExecutor,
        AiCallTimeouts.defaults(),
        Clock.systemUTC());
  }

  /** 단위 테스트용 — 상한 표와 시계까지 직접 넣는다(시간 예산 검증). */
  MailCategoryBackfillScheduler(
      TenantScopedRunner tenantRunner,
      EmailAccountRepository accountRepo,
      MailCategoryBackfillService categoryBackfill,
      Executor executor,
      LockingTaskExecutor lockingExecutor,
      AiCallTimeouts timeouts,
      Clock clock) {
    this.tenantRunner = tenantRunner;
    this.accountRepo = accountRepo;
    this.categoryBackfill = categoryBackfill;
    this.executor = executor;
    this.lockingExecutor = lockingExecutor;
    this.timeouts = timeouts;
    this.clock = clock;
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
    // 시간 예산은 회차 시작(잠금을 잡은 직후, 수집 전)부터 센다 — 수집(DB 읽기)도 잠금 안에서 흐르므로 마감이 잠금보다 늦게 잡히지 않게 첫 줄에서
    // 잡는다(WP-2111). 호출 하나의 최악은 이 호출의 실행 상한이 아니라 메일 클라이언트의 실제 읽기 상한(메일 항목 최대 + 여유)이다 — 같은 클라이언트라
    // ai-agent 가 상한을 지키지 않으면 HTTP 는 그만큼 기다린다.
    RoundDeadline deadline = RoundDeadline.underLock(clock, LOCK_AT_MOST);
    Duration perCall = MailAiConfig.readTimeout(timeouts);
    // ① 수집: 테넌트별 짧은 트랜잭션(GUC 주입) 안에서 모든 활성 계정을 모은다. 비서 해석(공통 → AI 사용 계정의 개인)은 서비스가 계정별로 한다.
    List<Target> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          for (ActiveAccount a : accountRepo.findActiveForSync()) {
            targets.add(new Target(tenantId, a.userId(), a.accountId()));
          }
        });
    if (targets.isEmpty()) {
      return;
    }
    // findActiveForSync 는 ORDER BY 가 없어 순서가 들쭉날쭉하다 — (tenantId, accountId) 로 고정한 뒤 회차마다 시작 위치를 한 칸씩
    // 돌린다.
    targets.sort(Comparator.comparingLong(Target::tenantId).thenComparingLong(Target::accountId));
    Collections.rotate(targets, -Math.floorMod(rotation++, targets.size()));
    // ② 실행: 트랜잭션 밖. TenantContext 만 주입(서비스 내부 TransactionTemplate 이 GUC 주입).
    AgentOutageGuard guard = new AgentOutageGuard();
    int budget = MAX_BATCHES_PER_ROUND;
    int remaining = targets.size();
    for (Target t : targets) {
      if (guard.tripped()) {
        log.warn("분류 일괄 회차 중단 — ai-agent 불가, 남은 계정 {}개는 다음 주기", remaining);
        return;
      }
      if (budget <= 0) {
        log.info("분류 일괄 회차 상한 도달 — 남은 계정 {}개는 다음 주기", remaining);
        return;
      }
      // 남은 시간에 최악(실행 상한 + 읽기 여유)으로 다 끝나는 호출 수만 넘긴다 — 서비스는 그 수를 넘겨 부르지 않으므로 다음 호출 시작 전 마감 확인과 같다.
      int fitting = deadline.fittingCalls(perCall);
      if (fitting <= 0) {
        log.info("분류 일괄 회차 시간 예산 소진 — 남은 계정 {}개는 다음 주기", remaining);
        return;
      }
      remaining--;
      TenantContext.set(t.tenantId());
      try {
        budget -=
            categoryBackfill.classifyAccountNow(
                t.userId(), t.accountId(), guard, Math.min(budget, fitting));
      } catch (RuntimeException e) {
        // 서비스는 계정별 실패를 스스로 삼키고 실제 호출 수를 돌려주므로 여기까지 오지 않는 게 정상이다 — 방어용으로만 남기고 예산은 깎지 않는다.
        log.warn("분류 일괄 실패 tenant={} account={}", t.tenantId(), t.accountId(), e);
      } finally {
        TenantContext.clear();
      }
    }
  }
}
