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
 * 메일 자동 동기화 스케줄러.
 *
 * <p>3분마다(fixedDelay=180s) 모든 활성 테넌트의 메일 계정을 순회하며 IMAP 동기화를 수행한다. 스케줄러는 요청 밖 스레드에서 실행되므로 HTTP 필터가
 * 주입하는 테넌트 GUC가 없다. 따라서 RLS가 없는 tenant 테이블을 직접 조회해 테넌트 ID를 열거한 뒤, 테넌트마다 {@link TenantContext}를 세팅해
 * 각각의 {@link EmailAccountRepository#findActiveForSync()} 가 올바른 RLS 컨텍스트에서 실행되도록 한다.
 *
 * <p>설계 의도: {@code sync()} 는 IMAP 네트워크 I/O를 포함하므로 감싸는 트랜잭션을 두지 않는다. 감싸면 커넥션이 IMAP 왕복 내내
 * idle-in-transaction 상태가 되어 커넥션 풀을 소모한다. {@code findActiveForSync()}
 * 자체가 @Transactional(readOnly=true)이고, sync 내부도 짧은 메시지 단위 트랜잭션을 사용하므로 GUC 주입은 각 트랜잭션 시작 시
 * TenantAwareTransactionManager가 담당한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MailAutoSyncScheduler {

  private final TenantRepository tenantRepository;
  private final EmailAccountRepository accountRepo;
  private final MailSyncService syncService;

  /**
   * 스케줄 진입점 — 이전 사이클 완료 후 3분 뒤(fixedDelay) 재실행. 기동 후 30초 뒤 첫 실행(initialDelay)으로 애플리케이션 초기화를 충분히
   * 기다린다.
   */
  @Scheduled(fixedDelay = 180_000, initialDelay = 30_000)
  public void scheduled() {
    syncAllTenants();
  }

  /**
   * 전 활성 테넌트를 순회하며 활성 메일 계정을 동기화한다. 테스트에서 직접 호출하는 진입점.
   *
   * <p>테넌트 루프:
   *
   * <ol>
   *   <li>{@link TenantContext#set}으로 테넌트 컨텍스트 세팅 → RLS GUC 준비
   *   <li>{@link EmailAccountRepository#findActiveForSync()}로 현재 테넌트 활성 계정 조회(자체 @Transactional)
   *   <li>계정별 {@link MailSyncService#sync} 호출 — try/catch로 격리해 한 계정 실패가 다른 계정/테넌트를 막지 않도록
   *   <li>finally에서 {@link TenantContext#clear()}로 스레드 풀 컨텍스트 오염 방지
   * </ol>
   */
  public void syncAllTenants() {
    List<Long> tenantIds = tenantRepository.findActiveTenantIds();
    log.debug("메일 자동 동기화 시작 — 활성 테넌트 {}개", tenantIds.size());

    for (Long tenantId : tenantIds) {
      try {
        TenantContext.set(tenantId);
        // 자체 @Transactional(readOnly=true) 가 doBegin 시점에 TenantContext → GUC 주입
        List<ActiveAccount> accounts = accountRepo.findActiveForSync();
        log.debug("테넌트 {} 활성 계정 {}개 동기화", tenantId, accounts.size());

        for (ActiveAccount a : accounts) {
          try {
            // sync 는 내부 짧은 트랜잭션마다 TenantContext 를 읽어 GUC 를 재주입하므로
            // TenantContext 를 살려둔 채 호출한다.
            syncService.sync(a.userId(), a.accountId());
          } catch (Exception e) {
            // 한 계정 실패는 로그만 남기고 계속 진행 — 자동 동기화 실패는 사용자 알림 대상 아님.
            log.warn("테넌트 {} 계정 {} 자동 동기화 실패 — 건너뜀", tenantId, a.accountId(), e);
          }
        }
      } finally {
        // 스레드 풀 재사용 시 stale 컨텍스트 오염 방지
        TenantContext.clear();
      }
    }

    log.debug("메일 자동 동기화 완료");
  }
}
