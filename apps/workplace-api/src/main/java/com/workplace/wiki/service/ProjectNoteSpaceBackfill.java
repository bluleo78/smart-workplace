package com.workplace.wiki.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.wiki.repository.ProjectNoteSpaceRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 프로젝트 노트 공간 백필(WP-1480) — 이 기능 전에 만든 팀·공개(TEAM·OPEN) 프로젝트에도 공간을 만들어 준다. 새 프로젝트는 생성 이벤트로 공간이 생기므로
 * 기동 때 한 번 「공간 없는 지워지지 않은 TEAM·OPEN 프로젝트」만 채운다({@link ProjectNoteSpaceService#ensureSpace} — 만들기 +
 * 멤버 맞추기 + 「리포트」).
 *
 * <ul>
 *   <li><b>멱등</b> — 공간이 생긴 프로젝트는 대상에서 빠지므로 다시 돌아도 공간이 늘지 않는다.
 *   <li><b>여러 대 동시 기동</b> — 테넌트마다 advisory xact lock 을 시도해 한 대만 처리한다(AgentAccountBackfill 과 같은 방식).
 *   <li><b>프로젝트 하나의 실패는 그 프로젝트만</b> — savepoint 를 되돌리고 경고 로그 후 다음 프로젝트로. 어떤 실패도 기동을 막지 않는다.
 * </ul>
 */
@Slf4j
@Component
public class ProjectNoteSpaceBackfill {

  private final TenantScopedRunner tenantRunner;
  private final ProjectNoteSpaceRepository projects;
  private final ProjectNoteSpaceService service;

  /** 테넌트 하나를 한 트랜잭션에서 — 이미 트랜잭션 안이면(테넌트 순회·테스트) 그것에 합류한다. */
  private final TransactionTemplate tenantTx;

  /** 프로젝트 하나의 savepoint — 한 프로젝트의 실패가 테넌트 트랜잭션 전체를 rollback-only 로 만들지 않게. */
  private final TransactionTemplate savepoint;

  /** 기동 때 돌지 — 테스트 프로파일은 끈다(캐시된 테스트 컨텍스트마다 다른 테스트가 남긴 프로젝트에 공간을 만들지 않게). */
  private final boolean onStartup;

  public ProjectNoteSpaceBackfill(
      TenantScopedRunner tenantRunner,
      ProjectNoteSpaceRepository projects,
      ProjectNoteSpaceService service,
      PlatformTransactionManager txManager,
      @Value("${workplace.wiki.project-space-backfill-on-startup:true}") boolean onStartup) {
    this.tenantRunner = tenantRunner;
    this.projects = projects;
    this.service = service;
    this.tenantTx = new TransactionTemplate(txManager);
    this.savepoint = new TransactionTemplate(txManager);
    this.savepoint.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    this.onStartup = onStartup;
  }

  /** 기동 뒤 진입점 — 켜져 있으면 모든 활성 테넌트를 돈다. */
  @EventListener(ApplicationReadyEvent.class)
  public void onApplicationReady() {
    if (onStartup) backfillAllTenants();
  }

  /** 모든 활성 테넌트를 테넌트별 트랜잭션(GUC)에서 채운다 — 한 테넌트의 실패는 경고 후 다음 테넌트로(TenantScopedRunner). */
  public void backfillAllTenants() {
    try {
      tenantRunner.forEachActiveTenant(this::backfillTenant);
    } catch (RuntimeException e) {
      // 테넌트 목록 조회 실패 등 — 기동을 막지 않고 다음 기동에 다시 시도한다.
      log.warn("프로젝트 노트 공간 백필 실패 — 다음 기동에 다시 시도: {}", e.getClass().getSimpleName());
    }
  }

  /**
   * 테넌트 하나를 채운다. 다른 대가 이 테넌트를 처리 중이면(잠금을 못 잡음) 아무것도 하지 않는다.
   *
   * @return 이 테넌트에서 새로 공간을 만든 프로젝트 수
   */
  public int backfillTenant(long tenantId) {
    Integer n = TenantContext.callAs(tenantId, () -> tenantTx.execute(s -> backfillInTx(tenantId)));
    return n == null ? 0 : n;
  }

  /** 테넌트 트랜잭션 안의 본체 — 잠금 → 대상 모으기 → 프로젝트마다 savepoint 에서 공간 만들기. */
  private int backfillInTx(long tenantId) {
    if (!projects.tryLockBackfill(tenantId)) {
      log.info("프로젝트 노트 공간 백필 — 다른 서버가 처리 중이라 건너뜀 tenant={}", tenantId);
      return 0;
    }
    int created = 0;
    for (Long projectId : projects.findProjectIdsWithoutSpace()) {
      try {
        Boolean made = savepoint.execute(s -> service.ensureSpace(projectId, null).isPresent());
        if (Boolean.TRUE.equals(made)) created++;
      } catch (RuntimeException e) {
        // 예외 메시지는 싣지 않는다 — DB 오류 메시지에 값이 섞일 수 있다.
        log.warn("프로젝트 노트 공간 백필 건너뜀 — project={} ({})", projectId, e.getClass().getSimpleName());
      }
    }
    if (created > 0) log.info("프로젝트 노트 공간 백필 — tenant={} 만든 공간 {}개", tenantId, created);
    return created;
  }
}
