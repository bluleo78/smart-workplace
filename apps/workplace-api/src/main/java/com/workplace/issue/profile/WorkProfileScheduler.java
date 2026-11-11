package com.workplace.issue.profile;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 업무 프로파일 매일 갱신(WP-1485) — 매일 08:00 KST, 이미 저장된 프로파일(사람×기간) 중 그 워크스페이스에서 활성인 사람의 것만 다시 분석한다. 행이 없는
 * 사람은 카드를 열 때 처음 만들어지므로 AI 비용을 쓰지 않는다. 끝낸 이슈가 그대로면 지문으로 AI 호출을 건너뛴다.
 *
 * <p><b>차례로 돈다:</b> 저장 행 전부를 워커 풀(2스레드·큐 1000)에 한꺼번에 넣으면 넘친 행이 매일 아침 「분석이 몰려 있어요」로 FAILED 가 된다. 그래서
 * 스케줄러 스레드가 한 건씩 점유 → 분석(AI HTTP 는 트랜잭션 밖)을 동기로 처리한다.
 *
 * <p><b>잠금:</b> 여러 파드는 ShedLock 으로 한 번만 돈다. 회차가 AI 호출을 차례로 기다려 길어질 수 있어 lockAtMostFor 를 2시간으로 넉넉히
 * 둔다(기본 30분이면 긴 회차 도중 잠금이 풀린다). 2시간을 넘겨도 다른 파드는 다음 날 08:00 에야 깨므로 같은 날 겹쳐 돌지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WorkProfileScheduler {

  private final TenantScopedRunner tenantRunner;
  private final WorkProfileRepository repository;
  private final WorkProfileService service;

  /** 한 테넌트의 저장 프로파일 하나 — 어느 테넌트의 누구·어느 기간인지. */
  private record Target(long tenantId, WorkProfileRepository.Key key) {}

  /**
   * 한 회차 집계 — 대상 수와 실제로 일어난 일의 건수.
   *
   * @param targets 갱신 대상(활성 구성원의 저장 행)
   * @param refreshed 새로 분석해 저장
   * @param unchanged 끝낸 이슈가 그대로라 AI 없이 기간만 갱신
   * @param failed 실패로 기록(오류 포함)
   * @param skipped 이미 분석 중이었거나 그 사이 다른 요청이 다시 점유
   */
  public record Summary(int targets, int refreshed, int unchanged, int failed, int skipped) {}

  /** 매일 08:00(Asia/Seoul) — 활성 구성원의 저장 프로파일을 차례로 갱신한다. */
  @Scheduled(cron = "0 0 8 * * *", zone = "Asia/Seoul")
  @SchedulerLock(name = "WorkProfileScheduler.refreshDaily", lockAtMostFor = "PT2H")
  public void refreshDaily() {
    Summary s = refreshAllTenants();
    if (s.targets() > 0) {
      log.info(
          "업무 프로파일 매일 갱신 — 대상 {}건: 새로 분석 {} · 그대로 {} · 실패 {} · 건너뜀 {}",
          s.targets(),
          s.refreshed(),
          s.unchanged(),
          s.failed(),
          s.skipped());
    }
  }

  /**
   * 모든 활성 테넌트의 저장 프로파일을 차례로 갱신하고 결과를 센다(테스트·수동 실행 진입점).
   *
   * <p>러너 트랜잭션 안에서는 (테넌트, 키) 목록만 모은다 — AI 호출이 러너 트랜잭션에 묶이지 않게 하려는 것. 목록은 트랜잭션이 끝난 뒤 하나씩
   * TenantContext 를 세워 이 스레드에서 동기로 처리하고, 한 건의 실패는 경고만 남기고 다음으로 넘어간다.
   */
  public Summary refreshAllTenants() {
    List<Target> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> repository.findAllKeys().forEach(k -> targets.add(new Target(tenantId, k))));
    Map<WorkProfileService.RunResult, Integer> counts =
        new EnumMap<>(WorkProfileService.RunResult.class);
    for (Target t : targets) {
      TenantContext.set(t.tenantId());
      WorkProfileService.RunResult result;
      try {
        result = service.refreshScheduled(t.key().userId(), t.key().period());
      } catch (RuntimeException e) {
        log.warn(
            "업무 프로파일 갱신 실패 tenant={} userId={} period={}: {}",
            t.tenantId(),
            t.key().userId(),
            t.key().period(),
            e.toString());
        result = WorkProfileService.RunResult.FAILED;
      } finally {
        TenantContext.clear();
      }
      counts.merge(result, 1, Integer::sum);
    }
    return new Summary(
        targets.size(),
        counts.getOrDefault(WorkProfileService.RunResult.REFRESHED, 0),
        counts.getOrDefault(WorkProfileService.RunResult.UNCHANGED, 0),
        counts.getOrDefault(WorkProfileService.RunResult.FAILED, 0),
        counts.getOrDefault(WorkProfileService.RunResult.SKIPPED, 0)
            + counts.getOrDefault(WorkProfileService.RunResult.SUPERSEDED, 0));
  }
}
