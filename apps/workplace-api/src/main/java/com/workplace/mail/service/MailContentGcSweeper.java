package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.tenant.repository.TenantRepository;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 미참조 email_content 고아 행 정기 스윕(백스톱 GC).
 *
 * <p>envelope 삭제 시 refcount GC({@link
 * com.workplace.mail.repository.EmailMessageRepository#deleteByFolder} 등)가 주 경로이지만, 예외나 다른 삭제 경로에서
 * 누락된 고아 content 를 주기적으로 정리한다.
 *
 * <p>순수 DB 작업이므로 IMAP/LLM 와 달리 트랜잭션 안에서 실행해도 안전하다. 테넌트별로 GUC 가 주입된 트랜잭션 안에서 삭제를 실행한다 —
 * email_content 는 테넌트 RLS 가 적용된 테이블이므로 GUC 없이 실행하면 고아 행을 가려 실효 없이 리턴된다.
 */
@Slf4j
@Component
public class MailContentGcSweeper {

  private final TenantRepository tenantRepository;
  private final EmailContentRepository contentRepo;
  private final TransactionTemplate txTemplate;

  public MailContentGcSweeper(
      TenantRepository tenantRepository,
      EmailContentRepository contentRepo,
      PlatformTransactionManager txManager) {
    this.tenantRepository = tenantRepository;
    this.contentRepo = contentRepo;
    // @Primary TenantAwareTransactionManager 사용 — 트랜잭션 진입 시 GUC 주입
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** 스케줄 진입점 — 이전 사이클 완료 후 1시간 뒤 재실행. 기동 후 2분 뒤 첫 실행으로 초기화를 기다린다. */
  @Scheduled(fixedDelay = 3_600_000, initialDelay = 120_000)
  @SchedulerLock(name = "MailContentGcSweeper.scheduled")
  public void scheduled() {
    sweepAllTenants();
  }

  /**
   * 모든 활성 테넌트를 순회하며 고아 email_content 를 삭제한다.
   *
   * <p>테스트에서 직접 호출하는 진입점. 각 테넌트마다 {@link TenantContext}를 세팅해 트랜잭션 시작 시 {@code
   * TenantAwareTransactionManager}가 GUC 를 주입하도록 한다.
   */
  public void sweepAllTenants() {
    List<Long> tenantIds = tenantRepository.findActiveTenantIds();
    log.debug("메일 content GC 스윕 시작 — 활성 테넌트 {}개", tenantIds.size());

    for (Long tenantId : tenantIds) {
      try {
        TenantContext.set(tenantId);
        sweepTenant();
      } catch (Exception e) {
        log.warn("테넌트 {} content GC 스윕 실패 — 건너뜀", tenantId, e);
      } finally {
        TenantContext.clear();
      }
    }

    log.debug("메일 content GC 스윕 완료");
  }

  /**
   * 현재 테넌트(TenantContext 기준)의 고아 email_content 를 삭제한다.
   *
   * <p>순수 DB 작업이므로 트랜잭션 안에서 실행한다 — TenantAwareTransactionManager 가 GUC 를 주입해 RLS 가 올바르게 동작한다.
   */
  public void sweepTenant() {
    // 트랜잭션 안에서 실행 → TenantAwareTransactionManager 가 GUC 주입 → RLS 활성화
    // email_message 에 참조되지 않는 email_content 를 모두 삭제 — 딸린 첨부 추출 사본(WP-358)은 삭제 직전에 만료시킨다.
    Integer deleted = txTemplate.execute(status -> contentRepo.deleteAllOrphans());

    if (deleted != null && deleted > 0) {
      log.info("테넌트 {} 고아 email_content {} 건 삭제", TenantContext.get(), deleted);
    }
  }
}
