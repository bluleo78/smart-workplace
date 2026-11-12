package com.workplace.issue.overview.status;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.issue.overview.status.ProjectStatusSummaryService.Outcome;
import java.time.Clock;
import java.time.OffsetDateTime;
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
 * 프로젝트 상태 AI 요약 실행기(WP-1479) — 5분마다, 공통 비서가 있는 워크스페이스에서 점검 시각이 된 프로젝트(삭제·개인 제외)의 요약을 차례로 점검한다.
 * 프로젝트마다 간격(1·2·4시간·하루)은 {@code next_run_at} 이 맡으므로 이 주기는 「얼마나 늦게 알아채도 되나」만 정한다.
 *
 * <p><b>겹침 방지:</b> 여러 파드는 ShedLock 으로 한 번만 돈다. 회차가 lockAtMostFor(30분)를 넘겨 잠금이 풀려도, 서비스의 실행권
 * 잡기(claim — next_run_at 조건부 갱신)가 같은 프로젝트를 두 번 돌지 않게 막는다.
 *
 * <p><b>처리 상한:</b> 한 회차는 {@link #MAX_PER_RUN} 개까지만 처리하고 나머지는 다음 회차로 넘긴다(첫 배포 때 한 회차가 잠금 시간을 넘지 않게).
 *
 * <p><b>트랜잭션:</b> 러너 트랜잭션 안에서는 (테넌트, 프로젝트) 목록만 모은다. AI 호출이 러너 트랜잭션에 묶이지 않도록, 목록은 트랜잭션이 끝난 뒤 하나씩
 * TenantContext 를 세워 이 스레드에서 처리한다(WorkProfileScheduler 와 같은 모양). 한 건의 실패는 경고만 남기고 다음으로 넘어간다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ProjectStatusSummaryScheduler {

  private final TenantScopedRunner tenantRunner;
  private final AssistantResolver assistantResolver;
  private final ProjectStatusSummaryRepository repository;
  private final ProjectStatusSummaryService service;

  /**
   * 한 회차에 처리하는 프로젝트 수 상한(모든 테넌트 합계). 첫 배포 때는 모든 프로젝트가 한꺼번에 대상이 되는데, 한 건마다 AI 호출(최대 수십 초)이 이어져 한 회차가
   * ShedLock 잠금(30분)을 넘기면 다른 파드가 겹쳐 돌 수 있다 — 그래서 한 회차를 묶고, 나머지는 다음 5분 회차에 이어서 처리한다.
   */
  static final int MAX_PER_RUN = 30;

  /** 「지금」의 기준 시계. */
  private final Clock clock = Clock.systemUTC();

  /** 한 테넌트의 대상 프로젝트 하나. */
  private record Target(long tenantId, long projectId) {}

  /**
   * 한 회차 집계.
   *
   * @param targets 대상 프로젝트 수
   * @param generated AI 가 새로 씀
   * @param unchanged 입력이 그대로라 시각만 넘김
   * @param empty 이슈가 없어 건너뜀
   * @param skipped 실행권을 잡지 못함·공통 비서 없음
   * @param failed 실패(이전 요약 유지)
   */
  public record Summary(
      int targets, int generated, int unchanged, int empty, int skipped, int failed) {}

  /** 5분마다(기동 1분 뒤 시작) — 점검 시각이 된 프로젝트의 상태 요약을 점검한다. */
  @Scheduled(fixedDelay = 300_000, initialDelay = 60_000)
  @SchedulerLock(name = "ProjectStatusSummaryScheduler.runOnce", lockAtMostFor = "PT30M")
  public void runOnce() {
    Summary s = runOnce(clock);
    if (s.targets() > 0) {
      log.info(
          "프로젝트 상태 요약 — 대상 {}건: 새로 씀 {} · 그대로 {} · 이슈 없음 {} · 건너뜀 {} · 실패 {}",
          s.targets(),
          s.generated(),
          s.unchanged(),
          s.empty(),
          s.skipped(),
          s.failed());
    }
  }

  /**
   * 한 회차(테스트·수동 실행 진입점) — 공통 비서가 없는 테넌트는 대상을 모으지 않는다(AI 를 못 쓰는 워크스페이스에 요약을 만들지 않음).
   *
   * <p>「지금」은 프로젝트마다 시계에서 다시 읽는다 — AI 호출이 이어져 회차가 길어져도, 뒤쪽 프로젝트의 점유·점검 시각과 다음 점검 시각이 회차 시작 시각에 묶여
   * 앞당겨지지 않게.
   *
   * @param runClock 「지금」의 시계 — 대상 선별은 회차 시작 시각, 서비스 호출은 프로젝트마다 읽은 시각
   */
  public Summary runOnce(Clock runClock) {
    return runOnce(runClock, MAX_PER_RUN);
  }

  /**
   * 처리 상한을 받는 한 회차 — 테스트가 작은 상한으로 「상한만 처리하고 나머지는 다음 회차」를 확인한다. 상한은 테넌트별이 아니라 전체 합계로 자른다(테넌트 순서 →
   * 프로젝트 id 순). 처리한 프로젝트는 다음 점검 시각이 밀리므로 남은 프로젝트가 다음 회차 앞쪽에 온다.
   *
   * @param runClock 「지금」의 시계
   * @param limit 이번 회차에 처리할 최대 프로젝트 수
   */
  Summary runOnce(Clock runClock, int limit) {
    OffsetDateTime now = OffsetDateTime.now(runClock);
    List<Target> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          // 상한이 찼으면 남은 테넌트는 비서 해석·목록 조회도 하지 않는다.
          if (targets.size() >= limit) return;
          if (assistantResolver.resolveWorkspaceOrEmpty().isEmpty()) return;
          // 남은 자리만큼만 받아 온다 — 상한 밖 id 를 읽어 버리지 않게.
          for (Long pid : repository.dueProjectIds(now, limit - targets.size())) {
            targets.add(new Target(tenantId, pid));
          }
        });
    Map<Outcome, Integer> counts = new EnumMap<>(Outcome.class);
    for (Target t : targets) {
      TenantContext.set(t.tenantId());
      Outcome outcome;
      try {
        outcome = service.refresh(t.projectId(), OffsetDateTime.now(runClock));
      } catch (RuntimeException e) {
        log.warn(
            "프로젝트 상태 요약 실패 tenant={} projectId={}: {}", t.tenantId(), t.projectId(), e.toString());
        outcome = Outcome.FAILED;
      } finally {
        TenantContext.clear();
      }
      counts.merge(outcome, 1, Integer::sum);
    }
    return new Summary(
        targets.size(),
        counts.getOrDefault(Outcome.GENERATED, 0),
        counts.getOrDefault(Outcome.UNCHANGED, 0),
        counts.getOrDefault(Outcome.SKIPPED_EMPTY, 0),
        counts.getOrDefault(Outcome.SKIPPED, 0),
        counts.getOrDefault(Outcome.FAILED, 0));
  }
}
