package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAccountRepository.ActiveAccount;
import com.workplace.tenant.repository.TenantRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 비활성(soft-deleted) 메일 계정 물리 삭제 스케줄러.
 *
 * <p>5분마다 전 활성 테넌트를 순회하며 disabled_at 이 채워진 계정을 {@link AccountPurgeService#purgeAccount} 로 완전 삭제한다.
 * 화면에서는 이미 숨겨진 상태이므로 즉시성이 필요 없고, 무거운 GC·디스크 삭제를 백그라운드로 분리한다.
 *
 * <p>{@link MailAutoSyncScheduler} 와 동일 패턴: 요청 밖 스레드이므로 테넌트별 TenantContext.set 으로 RLS GUC 를 준비하고,
 * 계정마다 try/catch 로 격리(한 계정 실패가 다른 계정/테넌트를 막지 않음), finally 에서 clear 로 스레드 풀 오염을 방지한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AccountPurgeScheduler {

  private final TenantRepository tenantRepository;
  private final EmailAccountRepository accountRepo;
  private final AccountPurgeService purgeService;

  /** 스케줄 진입점 — 이전 사이클 완료 후 5분 뒤(fixedDelay), 기동 후 90초 뒤 첫 실행(initialDelay). */
  @Scheduled(fixedDelay = 300_000, initialDelay = 90_000)
  public void scheduled() {
    purgeAllTenants();
  }

  /** 전 활성 테넌트의 비활성 계정을 purge 한다. 테스트 진입점. */
  public void purgeAllTenants() {
    List<Long> tenantIds = tenantRepository.findActiveTenantIds();
    for (Long tenantId : tenantIds) {
      try {
        TenantContext.set(tenantId);
        List<ActiveAccount> targets = accountRepo.findDisabledForPurge();
        for (ActiveAccount a : targets) {
          try {
            purgeService.purgeAccount(a.userId(), a.accountId());
          } catch (Exception e) {
            log.warn("테넌트 {} 계정 {} purge 실패 — 다음 사이클 재시도", tenantId, a.accountId(), e);
          }
        }
      } finally {
        TenantContext.clear();
      }
    }
  }
}
