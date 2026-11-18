package com.workplace.notify.service;

import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.notify.repository.NotificationRepository;
import com.workplace.tenant.repository.TenantRepository;
import java.time.OffsetDateTime;
import java.util.concurrent.atomic.AtomicInteger;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 알림 자동 보관·정리 작업(WP-1690) — 읽은 지 {@link #AUTO_ARCHIVE_DAYS}일이 지난 알림을 보관하고, 보관한 지 {@link
 * #PURGE_DAYS}일이 지난 알림을 지운다. 같은 실행 안에서 보관 → 정리 순서로 처리한다. 안 읽은 알림은 보관하지 않는다.
 *
 * <p>실시간 이벤트를 내지 않는 이유: 대상은 7일 넘게 지난 읽은 알림이라 열려 있는 창의 목록이 바로 바뀔 필요가 없고, 다음 조회에 반영되면 충분하다. 수천 건을
 * 한꺼번에 내보내는 이벤트 폭주도 피한다.
 *
 * <p>테이블이 테넌트 RLS 라 {@link TenantScopedRunner} 로 활성 테넌트마다 GUC 가 주입된 트랜잭션에서 돈다. 묶음({@link
 * #BATCH}개)마다 트랜잭션을 따로 열어 긴 락을 피하고, 한 테넌트의 실패가 다른 테넌트를 막지 않게 테넌트별로 예외를 격리한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NotificationArchiveJob {
  /** 읽은 뒤 자동 보관까지의 일수. */
  static final int AUTO_ARCHIVE_DAYS = 7;

  /** 보관 뒤 영구 삭제까지의 일수. */
  static final int PURGE_DAYS = 90;

  /** 한 트랜잭션에서 처리하는 최대 행 수. */
  static final int BATCH = 1000;

  private final TenantScopedRunner tenantRunner;
  private final TenantRepository tenantRepository;
  private final NotificationRepository repo;

  /** 묶음 크기 — 기본 {@link #BATCH}, 시험이 여러 묶음 반복을 확인하려고 줄인다. */
  int batchSize = BATCH;

  /**
   * 기동 5분 뒤 첫 실행, 이후 직전 실행 종료 24시간 뒤. 러너의 forEachActiveTenant 는 테넌트 전체를 한 트랜잭션에 묶어 묶음별 트랜잭션을 못
   * 만들므로, 활성 테넌트 id 를 받아 테넌트마다 묶음 단위로 {@code runForTenant} 를 부른다.
   *
   * <p>잠금을 23시간 잡아 두는 이유: 기본 lockAtLeastFor(10초)는 동시 실행만 막아, 파드마다 시차를 두고 하루 한 번씩(+배포 뒤 5분마다) 또 돈다.
   * 실행이 끝나도 잠금을 23시간 남겨 클러스터 전체에서 하루 한 번만 돌게 한다. lockAtLeastFor 는 lockAtMostFor 보다 길 수 없어(ShedLock
   * 이 거부) lockAtMostFor 도 같게 둔다 — 실행 중 파드가 죽으면 다음 실행이 최대 23시간 밀리지만 하루 주기 정리 작업이라 괜찮다.
   */
  @Scheduled(initialDelay = 300_000, fixedDelay = 86_400_000)
  @SchedulerLock(
      name = "NotificationArchiveJob.run",
      lockAtLeastFor = "PT23H",
      lockAtMostFor = "PT23H")
  public void run() {
    for (Long tenantId : tenantRepository.findActiveTenantIds()) {
      try {
        int archived = drain(tenantId, AUTO_ARCHIVE_DAYS, repo::autoArchiveReadBefore);
        int purged = drain(tenantId, PURGE_DAYS, repo::deleteArchivedBefore);
        if (archived > 0 || purged > 0) {
          log.debug("알림 정리 테넌트 {} — 보관 {} 건, 삭제 {} 건", tenantId, archived, purged);
        }
      } catch (Exception e) {
        // 한 테넌트 실패가 다른 테넌트를 막지 않게 격리한다(다음 실행에서 이어서 처리).
        log.warn("테넌트 {} 알림 보관·정리 실패 — 건너뛰고 계속", tenantId, e);
      }
    }
  }

  /** 묶음 작업 한 번 — 기준 시각 이전 행을 최대 limit 개 처리하고 처리한 수를 돌려준다. */
  @FunctionalInterface
  private interface BatchOp {
    int run(OffsetDateTime cutoff, int limit);
  }

  /**
   * 묶음 작업을 묶음마다 새 트랜잭션으로 돌려, 한 묶음이 batchSize 보다 적게 처리될 때까지 반복하고 총 처리 수를 돌려준다. 기준 시각은 묶음마다 지금에서 days
   * 일 전으로 다시 잡는다.
   */
  private int drain(long tenantId, int days, BatchOp op) {
    int total = 0;
    int n;
    do {
      AtomicInteger done = new AtomicInteger();
      tenantRunner.runForTenant(
          tenantId, t -> done.set(op.run(OffsetDateTime.now().minusDays(days), batchSize)));
      n = done.get();
      total += n;
    } while (n >= batchSize);
    return total;
  }
}
