package com.workplace.home.service;

import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.repository.AiMemoryRepository;
import java.time.LocalDate;
import java.util.concurrent.atomic.AtomicInteger;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 만료 AI 메모리 정리 배치(WP-380) — 매일 04:10 KST, 기한이 지난 지 30일이 넘은 메모리를 지운다(10/10 만료 → 11/10 삭제, 웹 설정의 "11월
 * 10일에 지워져요"와 같다). ai_memory 는 FORCE RLS 라 GUC 없이 지우면 0행이다 — {@link TenantScopedRunner} 로 활성 테넌트마다
 * 짧은 트랜잭션(GUC 주입)에서 지운다. 테넌트 하나의 실패는 러너가 격리하고(경고 로그) 남은 행은 다음 날 다시 지운다. 여러 파드는 ShedLock 으로 한 번만 돈다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiMemoryExpiryCleanupScheduler {

  /** 만료 뒤 보관 일수 — 이 기간엔 설정 화면에서 기한 연장·계속 기억으로 되살릴 수 있다. */
  static final int KEEP_DAYS = 30;

  private final TenantScopedRunner tenantRunner;
  private final AiMemoryRepository repo;
  private final AiMemoryClock clock;

  /** 매일 04:10(Asia/Seoul). */
  @Scheduled(cron = "0 10 4 * * *", zone = AiMemoryClock.ZONE_ID)
  @SchedulerLock(name = "AiMemoryExpiryCleanupScheduler.purgeExpired")
  public void purgeExpired() {
    purgeAllTenants();
  }

  /** 모든 활성 테넌트에서 기한 + 30일이 지난 행을 지우고 합계를 돌려준다(테스트·수동 실행 진입점). */
  public int purgeAllTenants() {
    LocalDate cutoff = clock.today().minusDays(KEEP_DAYS);
    AtomicInteger total = new AtomicInteger();
    tenantRunner.forEachActiveTenant(tenantId -> total.addAndGet(repo.deleteExpiredBefore(cutoff)));
    if (total.get() > 0) log.info("만료 AI 메모리 정리 — {}건 (기한 {} 이전)", total.get(), cutoff);
    return total.get();
  }
}
