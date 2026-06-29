package com.workplace.mail.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.mail.dto.AiAccountRef;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAccountRepository.ActiveAccount;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BiConsumer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 선제 배치 요약 주기 트리거 — 10분마다 두 패스로 요약을 미리 채운다.
 *
 * <ul>
 *   <li>T1 객관적: 공통 비서가 있는 테넌트의 모든 활성 계정(ai_enabled 무관)에 content.ai_summary 채움.
 *   <li>T2 개인: AI ON 계정에 email_message.ai_personal_summary 채움.
 * </ul>
 *
 * ① {@link TenantScopedRunner} 로 테넌트별 짧은 트랜잭션(GUC 주입)에서 계정 목록만 수집, ② Runner 트랜잭션 밖에서 TenantContext
 * 만 주입해 계정별 요약 — IMAP/LLM 이 DB 커넥션을 장기 점유하지 않게 한다(#232).
 */
@Slf4j
@Component
public class MailSummaryScheduler {

  /** 수집 단계 산출 — 어느 테넌트의 어느 사용자/계정인지. */
  private record TenantAccount(long tenantId, long userId, long accountId) {}

  private final TenantScopedRunner tenantRunner;
  private final EmailAccountRepository accountRepo;
  private final AssistantResolver assistantResolver;
  private final MailSummaryBackfillService backfill;

  public MailSummaryScheduler(
      TenantScopedRunner tenantRunner,
      EmailAccountRepository accountRepo,
      AssistantResolver assistantResolver,
      MailSummaryBackfillService backfill) {
    this.tenantRunner = tenantRunner;
    this.accountRepo = accountRepo;
    this.assistantResolver = assistantResolver;
    this.backfill = backfill;
  }

  /** 10분 주기 — T1 객관적(공통비서 테넌트 전체 계정) + T2 개인(AI 계정). */
  @Scheduled(fixedRate = 600_000)
  void runOnce() {
    // ① 수집: 테넌트별 짧은 트랜잭션(GUC 주입) 안에서 대상 계정만 모은다.
    List<TenantAccount> objectiveTargets = new ArrayList<>();
    List<TenantAccount> personalTargets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          // T1: 공통비서가 정의된 테넌트에서만, 모든 활성 계정 대상.
          if (assistantResolver.resolveWorkspaceOrEmpty().isPresent()) {
            for (ActiveAccount a : accountRepo.findActiveForSync()) {
              objectiveTargets.add(new TenantAccount(tenantId, a.userId(), a.accountId()));
            }
          }
          // T2: AI 켠 계정만.
          for (AiAccountRef ref : accountRepo.listAiEnabledAccounts()) {
            personalTargets.add(new TenantAccount(tenantId, ref.userId(), ref.accountId()));
          }
        });
    // ② 실행: Runner 트랜잭션 밖. TenantContext 만 주입(backfill 내부가 짧은 트랜잭션으로 GUC 주입).
    runTargets(objectiveTargets, backfill::summarizeObjectiveRecentNow, "객관적");
    runTargets(personalTargets, backfill::summarizePersonalRecentNow, "개인");
  }

  /**
   * 대상 목록을 순회하며 패스를 실행한다. TenantContext 를 주입하면 backfill 내부 TransactionTemplate 이 GUC 를 주입한다.
   *
   * @param targets 수집 단계에서 모인 (tenantId, userId, accountId) 목록
   * @param pass backfill 메서드 참조 (userId, accountId) 를 받는 BiConsumer
   * @param label 로그 레이블
   */
  private void runTargets(List<TenantAccount> targets, BiConsumer<Long, Long> pass, String label) {
    for (TenantAccount t : targets) {
      TenantContext.set(t.tenantId());
      try {
        pass.accept(t.userId(), t.accountId()); // (userId, accountId)
      } catch (RuntimeException e) {
        log.warn("선제 요약({}) 실패 tenant={} account={}", label, t.tenantId(), t.accountId(), e);
      } finally {
        TenantContext.clear();
      }
    }
  }
}
