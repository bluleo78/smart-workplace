package com.workplace.home.service;

import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.repository.AiMemoryChangeRepository;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.Owned;
import com.workplace.home.repository.SharedAiMemoryChangeRepository;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
 *
 * <p>WP-385: 같은 회차에 (1) AI 가 저장해 고정 안 된 메모리가 90일 넘게 쓰이지 않았으면 지우고 DECAYED 기록을 남기며(사용자마다 run_id 하나 —
 * 기록 화면에서 되돌린다), (2) 30일 지난 「AI가 정리한 기록」을 지운다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiMemoryExpiryCleanupScheduler {

  /** 만료 뒤 보관 일수 — 이 기간엔 설정 화면에서 기한 연장·계속 기억으로 되살릴 수 있다. */
  static final int KEEP_DAYS = 30;

  /** 감쇠 삭제 일수(WP-385) — AI 저장·고정 아님·이만큼 쓰이지 않으면 지운다. */
  static final int DECAY_DAYS = 90;

  /** 정리 기록 보관 일수(WP-385). */
  static final int CHANGE_KEEP_DAYS = 30;

  private final TenantScopedRunner tenantRunner;
  private final AiMemoryRepository repo;
  private final AiMemoryClock clock;
  private final AiMemoryChangeRepository changeRepo;
  private final AiMemoryChangeLog changeLog;
  private final SharedAiMemoryChangeRepository sharedChanges;

  /** 매일 04:10(Asia/Seoul) — 만료 삭제 → 감쇠 삭제 → 기록 보관 정리 → 공용 메모리 기록 보관 정리. */
  @Scheduled(cron = "0 10 4 * * *", zone = AiMemoryClock.ZONE_ID)
  @SchedulerLock(name = "AiMemoryExpiryCleanupScheduler.purgeExpired")
  public void purgeExpired() {
    purgeAllTenants();
    decayAllTenants();
    purgeOldChangesAllTenants();
    purgeSharedChangesAllTenants();
  }

  /** 모든 활성 테넌트에서 기한 + 30일이 지난 행을 지우고 합계를 돌려준다(테스트·수동 실행 진입점). */
  public int purgeAllTenants() {
    LocalDate cutoff = clock.today().minusDays(KEEP_DAYS);
    AtomicInteger total = new AtomicInteger();
    tenantRunner.forEachActiveTenant(tenantId -> total.addAndGet(repo.deleteExpiredBefore(cutoff)));
    if (total.get() > 0) log.info("만료 AI 메모리 정리 — {}건 (기한 {} 이전)", total.get(), cutoff);
    return total.get();
  }

  /** 모든 활성 테넌트에서 90일 넘게 안 쓴 AI 메모리를 지우고 DECAYED 기록을 남긴다 — 지운 합계(테스트·수동 실행 진입점). */
  public int decayAllTenants() {
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    OffsetDateTime cutoff = now.minusDays(DECAY_DAYS);
    AtomicInteger total = new AtomicInteger();
    tenantRunner.forEachActiveTenant(tenantId -> total.addAndGet(decay(cutoff, now)));
    if (total.get() > 0) log.info("감쇠 AI 메모리 정리 — {}건 (사용 {} 이전)", total.get(), cutoff);
    return total.get();
  }

  /**
   * 한 테넌트(러너 트랜잭션 안) — 지운 행마다 DECAYED 기록(다건 INSERT 한 번), 같은 사용자는 run_id 하나. 지운 행과 기록이 한 트랜잭션이라 함께
   * 남거나 함께 사라진다.
   */
  private int decay(OffsetDateTime cutoff, OffsetDateTime at) {
    List<Owned> gone = repo.deleteDecayed(cutoff);
    Map<Long, UUID> runs = new HashMap<>();
    for (Owned o : gone) runs.computeIfAbsent(o.userId(), u -> UUID.randomUUID());
    changeLog.recordDecayed(gone, runs, at);
    return gone.size();
  }

  /** 모든 활성 테넌트에서 30일 지난 정리 기록을 지운다 — 지운 합계(테스트·수동 실행 진입점). */
  public int purgeOldChangesAllTenants() {
    OffsetDateTime cutoff = OffsetDateTime.now(ZoneOffset.UTC).minusDays(CHANGE_KEEP_DAYS);
    AtomicInteger total = new AtomicInteger();
    tenantRunner.forEachActiveTenant(
        tenantId -> total.addAndGet(changeRepo.deleteOlderThan(cutoff)));
    if (total.get() > 0) log.info("AI 메모리 정리 기록 보관 정리 — {}건 ({} 이전)", total.get(), cutoff);
    return total.get();
  }

  /** WP-386: 공용 메모리 공간 기록 90일 보관 — 지난 것을 활성 테넌트마다 지운다(테스트·수동 실행 진입점). */
  public int purgeSharedChangesAllTenants() {
    OffsetDateTime cutoff =
        OffsetDateTime.now(ZoneOffset.UTC).minusDays(SharedAiMemoryChangeService.KEEP_DAYS);
    AtomicInteger total = new AtomicInteger();
    tenantRunner.forEachActiveTenant(
        tenantId -> total.addAndGet(sharedChanges.deleteOlderThan(cutoff)));
    if (total.get() > 0) log.info("공용 메모리 기록 90일 정리 — {}건 ({} 이전)", total.get(), cutoff);
    return total.get();
  }
}
