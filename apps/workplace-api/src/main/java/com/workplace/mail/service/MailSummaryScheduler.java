package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.mail.dto.AiAccountRef;
import com.workplace.mail.repository.EmailAccountRepository;
import java.util.ArrayList;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 선제 배치 요약 주기 트리거 — 10분마다 활성 테넌트의 AI ON 계정의 안읽은·미요약 메일을 요약한다. 스케줄러 스레드는 요청 밖(GUC 미설정)이라 전역 조회는 RLS
 * fail-closed. ① {@link TenantScopedRunner} 로 테넌트별 짧은 트랜잭션에서 계정 목록만 수집(RLS 통과), ② Runner 트랜잭션 밖에서
 * TenantContext 만 주입해 계정별 요약 — IMAP/LLM 이 DB 커넥션을 장기 점유하지 않게 한다(#232).
 */
@Slf4j
@Component
public class MailSummaryScheduler {

  /** 수집 단계 산출 — 어느 테넌트의 어느 AI 계정인지. */
  private record TenantAccount(long tenantId, AiAccountRef ref) {}

  private final TenantScopedRunner tenantRunner;
  private final EmailAccountRepository accountRepo;
  private final MailSummaryBackfillService backfill;

  public MailSummaryScheduler(
      TenantScopedRunner tenantRunner,
      EmailAccountRepository accountRepo,
      MailSummaryBackfillService backfill) {
    this.tenantRunner = tenantRunner;
    this.accountRepo = accountRepo;
    this.backfill = backfill;
  }

  /** 10분 주기. */
  @Scheduled(fixedRate = 600_000)
  void runOnce() {
    // ① 테넌트별 AI 계정 수집 — Runner 가 테넌트별 짧은 트랜잭션 + GUC 주입(RLS 통과).
    List<TenantAccount> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          for (AiAccountRef ref : accountRepo.listAiEnabledAccounts()) {
            targets.add(new TenantAccount(tenantId, ref));
          }
        });
    // ② 계정별 요약 — Runner 트랜잭션 밖. TenantContext 만 주입하면 backfill 내부 짧은 트랜잭션이 GUC 주입.
    for (TenantAccount t : targets) {
      TenantContext.set(t.tenantId());
      try {
        backfill.summarizeRecentUnreadNow(t.ref().userId(), t.ref().accountId());
      } catch (RuntimeException e) {
        log.warn("선제 요약 스케줄 실패 tenant={} account={}", t.tenantId(), t.ref().accountId(), e);
      } finally {
        TenantContext.clear();
      }
    }
  }
}
