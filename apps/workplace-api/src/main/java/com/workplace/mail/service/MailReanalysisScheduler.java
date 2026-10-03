package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.mail.dto.AiAccountRef;
import com.workplace.mail.repository.EmailAccountRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 새 기준 재분석 트리거(WP-151) — 배포 직후와 AI 를 켠 뒤, ai_classify_version 이 낮은 AI 사용 계정을 찾아 {@link
 * MailReanalysisService#reanalyzeAccountNow} 로 계정당 1회 재분석한다.
 *
 * <ul>
 *   <li>부팅 2분 뒤 첫 실행 → "배포 직후"(agent 와 함께 배포될 여유). 이후 10분 간격 → AI 를 켠(off→on) 버전 0 계정이 다음 주기에 처리된다.
 *   <li>tick 은 전용 단일 스레드 실행기에 넘기기만 한다 — 스프링 스케줄러 공용 스레드(4개, 다른 @Scheduled 작업 공유 — WP-211)를 LLM 루프로
 *       잡지 않는다. 실행 중이면 그 tick 은 건너뛴다(running 플래그).
 *   <li>① {@link TenantScopedRunner} 로 테넌트별 짧은 트랜잭션(GUC)에서 대상 계정만 모으고, ② 트랜잭션 밖에서 계정마다
 *       TenantContext 를 주입해 재분석한다(#232 — LLM 이 DB 커넥션을 오래 잡지 않게).
 *   <li>실행 1회에 선점한 계정은 최대 {@value #MAX_ACCOUNTS_PER_RUN}개(LLM 최대 1,000회) — 나머지는 다음 주기.
 * </ul>
 *
 * <p>{@code ApplicationReadyEvent} 를 쓰지 않는 이유: 캐시된 테스트 컨텍스트마다 발화해
 * workplace.scheduling.enabled=false(WP-80)로 끌 수 없고, 동기 리스너는 readiness 를 늦춘다.
 */
@Slf4j
@Component
public class MailReanalysisScheduler {

  /** 실행 1회에 선점·처리할 계정 상한 — 배포 직후 LLM 폭주를 막는다. */
  static final int MAX_ACCOUNTS_PER_RUN = 20;

  /** 수집 단계 산출 — 어느 테넌트의 어느 사용자/계정인지. */
  private record Target(long tenantId, long userId, long accountId) {}

  private final TenantScopedRunner tenantRunner;
  private final EmailAccountRepository accountRepo;
  private final MailReanalysisService reanalysis;
  private final Executor executor;

  /** 실행 중 표시 — 이전 실행이 끝나기 전에 다음 tick 이 겹쳐 들어가지 않게 한다. */
  private final AtomicBoolean running = new AtomicBoolean(false);

  public MailReanalysisScheduler(
      TenantScopedRunner tenantRunner,
      EmailAccountRepository accountRepo,
      MailReanalysisService reanalysis,
      @Qualifier("mailReanalysisExecutor") Executor executor) {
    this.tenantRunner = tenantRunner;
    this.accountRepo = accountRepo;
    this.reanalysis = reanalysis;
    this.executor = executor;
  }

  /**
   * 주기 트리거 — 전용 실행기에 넘기기만 하고 바로 돌아온다. 실행 중이면 건너뛴다.
   *
   * <p>{@code @SchedulerLock} 을 붙이지 않는다(WP-165): tick 은 넘기자마자 끝나 잠금이 곧바로 풀리므로 실제 재분석 동안 다른 파드를 막지
   * 못한다. 파드 간 중복은 계정 단위 선점(재분석 버전 CAS, {@link MailReanalysisService})이 막는다 — 같은 계정은 한 파드만 선점한다.
   */
  @Scheduled(initialDelay = 120_000, fixedDelay = 600_000)
  void tick() {
    if (!running.compareAndSet(false, true)) {
      log.debug("재분석 실행 중 — 이번 주기 건너뜀");
      return;
    }
    try {
      executor.execute(
          () -> {
            try {
              runPendingNow();
            } catch (RuntimeException e) {
              // 수집 단계 실패(DB·테넌트 순회 등)가 조용히 사라지지 않게 남긴다 — 다음 주기에 다시 시도
              log.warn("재분석 실행 실패 — 다음 주기에 재시도: {}", e.toString());
            } finally {
              running.set(false);
            }
          });
    } catch (RejectedExecutionException e) {
      running.set(false); // 넘기지 못했으면 다음 tick 이 다시 시도하도록 표시를 푼다
      log.warn("재분석 실행기 거절 — 다음 주기에 재시도: {}", e.toString());
    }
  }

  /** 동기 본체 — 테스트는 이 메서드를 직접 호출한다. 계정별 실패는 삼키고 다음 계정으로. */
  public void runPendingNow() {
    // ① 수집: 테넌트별 짧은 트랜잭션(GUC 주입) 안에서 대상 계정만 모은다(선점은 처리 직전에).
    List<Target> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          for (AiAccountRef ref :
              accountRepo.listAiEnabledAccountsBelowClassifyVersion(
                  MailReanalysisService.CURRENT_CLASSIFY_VERSION)) {
            targets.add(new Target(tenantId, ref.userId(), ref.accountId()));
          }
        });
    // ② 실행: 트랜잭션 밖. TenantContext 만 주입(서비스 내부 TransactionTemplate 이 GUC 주입).
    int claimed = 0;
    for (int i = 0; i < targets.size(); i++) {
      if (claimed >= MAX_ACCOUNTS_PER_RUN) {
        log.info("재분석 실행당 상한 도달 — 남은 계정 {}개는 다음 주기", targets.size() - i);
        break;
      }
      Target t = targets.get(i);
      TenantContext.set(t.tenantId());
      try {
        if (reanalysis.reanalyzeAccountNow(t.userId(), t.accountId())) {
          claimed++;
        }
      } catch (RuntimeException e) {
        log.warn("재분석 실패 tenant={} account={}", t.tenantId(), t.accountId(), e);
      } finally {
        TenantContext.clear();
      }
    }
  }
}
