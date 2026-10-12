package com.workplace.platform.purge;

import com.workplace.platform.repository.PlatformTenantRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * PURGING 테넌트를 백그라운드에서 영구 삭제한다.
 *
 * <p>요청 스레드 @Async 대신 스케줄러를 쓰는 이유: 파드 재기동 후에도 PURGING 이 남아 있으면 이어서 처리되고, 다중 파드에서는 ShedLock 으로 한
 * 곳에서만 실행된다. 큰 테넌트는 오래 걸릴 수 있어 락 최대 보유 시간을 30분으로 둔다.
 *
 * <p>한 테넌트 실패가 나머지를 막지 않는다: 서비스가 단계별 실패를 purge_error 에 기록하고, 그 밖의 예외(실패 기록 자체가 던지는 경우 등)는 이 잡이 테넌트별
 * try/catch 로 격리해 로그만 남기고 다음 테넌트로 넘어간다(다음 주기에 재시도).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TenantPurgeJob {

  private final PlatformTenantRepository tenantRepository;
  private final TenantPurgeService purgeService;

  /** PURGING 상태 테넌트를 id 순으로 하나씩 영구 삭제한다. */
  @Scheduled(fixedDelayString = "${workplace.tenant-purge.delay-ms:30000}")
  @SchedulerLock(name = "TenantPurgeJob.run", lockAtMostFor = "PT30M")
  public void run() {
    for (Long id : tenantRepository.findPurgingTenantIds()) {
      // 서비스는 단계별 실패를 기록하고 삼키지만, 실패 기록 자체(DB 장애 등)가 던지면 나머지 테넌트가 밀리지 않도록 여기서 격리한다.
      try {
        purgeService.purge(id);
      } catch (RuntimeException e) {
        log.warn("테넌트 {} 영구 삭제 처리 중 예외 — 다음 주기에 재시도", id, e);
      }
    }
  }
}
