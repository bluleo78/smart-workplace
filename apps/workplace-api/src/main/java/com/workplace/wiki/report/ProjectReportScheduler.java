package com.workplace.wiki.report;

import com.workplace.airun.AiCallTimeouts;
import com.workplace.airun.RoundDeadline;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.issue.outbound.IssueAiConfig;
import com.workplace.wiki.report.ProjectReportGenerator.Outcome;
import java.time.Clock;
import java.time.Duration;
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
 * 프로젝트 리포트 실행기(WP-1483) — 5분마다, 공통 비서가 있는 워크스페이스에서 리포트를 켜 두었고 다음 실행 시각이 된 프로젝트(삭제·개인 제외)의 리포트를 차례로
 * 만든다. 주기(매주·격주·매월)·요일·시각은 프로젝트의 {@code next_run_at} 이 맡으므로 이 간격은 「얼마나 늦게 알아채도 되나」만 정한다. WP-1479
 * {@code ProjectStatusSummaryScheduler} 와 같은 모양이다.
 *
 * <p><b>겹침 방지:</b> 여러 파드는 ShedLock 으로 한 번만 돈다. 회차가 잠금 시간(40분)을 넘겨 풀려도 생성기의 실행권 잡기(next_run_at 조건부
 * 갱신)와 회차 예약(unique)이 같은 리포트를 두 번 만들지 않게 막는다.
 *
 * <p><b>처리 상한:</b> 한 회차는 {@link #MAX_PER_RUN} 개까지만 처리하고 나머지는 다음 회차로 — 한 건마다 AI 가 긴 글(수십 초~수 분)을 쓰므로
 * 한 회차가 잠금 시간을 넘지 않게 묶는다.
 *
 * <p><b>트랜잭션:</b> 러너 트랜잭션 안에서는 (테넌트, 프로젝트) 목록만 모은다. AI 호출·본문 쓰기가 러너 트랜잭션에 묶이지 않도록, 목록은 트랜잭션이 끝난 뒤
 * 하나씩 TenantContext 를 세워 이 스레드에서 처리한다. 한 건의 실패는 경고만 남기고 다음으로 넘어간다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ProjectReportScheduler {

  /**
   * 한 회차에 처리하는 프로젝트 수 상한(모든 테넌트 합계). 최악은 건마다 API 읽기 시간 제한(210초)까지 기다리는 경우라 5 × 210초 ≈ 17.5분 + 노트 쓰기
   * — 잠금 시간(40분) 안에 끝나게 묶는다(코드 리뷰 #4). 상한을 덮어써 건당 시간이 늘면 시간 예산({@link RoundDeadline})이 다음 건 시작 전에
   * 끊는다(WP-2111).
   */
  static final int MAX_PER_RUN = 5;

  private final TenantScopedRunner tenantRunner;
  private final AssistantResolver assistantResolver;
  private final ProjectReportSettingRepository settings;
  private final ProjectReportGenerator generator;
  private final AiAgentProperties aiAgentProperties;

  /** AI 호출 실행 상한 표(WP-2111) — 회차 시간 예산에서 한 건의 최악 시간을 계산한다. */
  private final AiCallTimeouts timeouts;

  /** 잠금 최대 — @SchedulerLock 의 lockAtMostFor 와 회차 마감 계산이 함께 쓰는 한 값. */
  static final String LOCK_AT_MOST_FOR = "PT40M";

  /** 잠금 최대 Duration — {@link #LOCK_AT_MOST_FOR} 를 파싱한 값. */
  static final Duration LOCK_AT_MOST = Duration.parse(LOCK_AT_MOST_FOR);

  /** 「지금」의 기준 시계. */
  private final Clock clock = Clock.systemUTC();

  /** 한 테넌트의 대상 프로젝트 하나. */
  private record Target(long tenantId, long projectId) {}

  /**
   * 한 회차 집계.
   *
   * @param processed 대상 프로젝트 수(결과와 상관없이)
   * @param generated 리포트 페이지를 새로 만듦
   * @param failed 실패(재시도 또는 다음 예정으로 넘김)
   */
  public record Summary(int processed, int generated, int failed) {}

  /** 5분마다(기동 90초 뒤 시작) — 때가 된 프로젝트의 리포트를 만든다. */
  @Scheduled(fixedDelay = 300_000, initialDelay = 90_000)
  @SchedulerLock(name = "ProjectReportScheduler.runOnce", lockAtMostFor = LOCK_AT_MOST_FOR)
  public void runOnce() {
    Summary s = runOnce(clock);
    if (s.processed() > 0) {
      log.info("프로젝트 리포트 — 대상 {}건: 새로 씀 {} · 실패 {}", s.processed(), s.generated(), s.failed());
    }
  }

  /**
   * 한 회차(테스트·수동 실행 진입점) — 공통 비서가 없는 테넌트는 대상을 모으지 않는다. 「지금」은 프로젝트마다 시계에서 다시 읽는다(회차가 길어져도 뒤쪽 프로젝트의 다음
   * 예정이 회차 시작 시각에 묶이지 않게).
   */
  public Summary runOnce(Clock runClock) {
    return runOnce(runClock, MAX_PER_RUN);
  }

  /**
   * 처리 상한을 받는 한 회차 — 상한은 테넌트별이 아니라 전체 합계로 자른다(테넌트 순서 → 다음 실행이 이른 순). 처리한 프로젝트는 다음 실행 시각이 밀리므로 남은
   * 프로젝트가 다음 회차 앞쪽에 온다.
   */
  Summary runOnce(Clock runClock, int limit) {
    // 회차 시간 예산(WP-2111) — 회차 시작(잠금 직후, 대상 수집 전)에 마감을 잡는다(수집도 잠금 안에서 흐른다).
    // 건당 최악은 리포트 클라이언트 읽기 상한(IssueAiConfig#reportReadTimeout) — 같은 클라이언트가 나르는 항목 최대 + 여유라, ai-agent
    // 가 상한을 지키지 않아도 HTTP 가 그만큼만 기다린다. 다음 건은 그 최악이 마감 안에 끝날
    // 때만 시작한다(개수 상한만으로는 상한을 덮어쓰면 잠금을 넘는다). 남은 대상은 다음 실행 시각이 그대로라 다음 회차 앞쪽에 온다.
    RoundDeadline deadline = RoundDeadline.underLock(runClock, LOCK_AT_MOST);
    Duration perCall = IssueAiConfig.reportReadTimeout(timeouts);
    // AI 연동이 꺼져 있으면 회차를 열지 않는다(WP-1639) — 재시도·건너뛰기로 회차를 잃지 않게. 다시 켜면 남은 예정부터 만든다.
    if (!aiAgentProperties.enabled()) return new Summary(0, 0, 0);
    OffsetDateTime now = OffsetDateTime.now(runClock);
    List<Target> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          if (targets.size() >= limit) return;
          // 한도 대기 중인 테넌트도 거르지 않는다(WP-2108) — 생성기가 예약을 풀고 다음 예정을 대기 해제 시각으로 미뤄 회차를 잃지 않는다.
          if (!assistantResolver.hasWorkspaceAssistant()) return;
          for (Long pid : settings.dueProjectIds(now, limit - targets.size())) {
            targets.add(new Target(tenantId, pid));
          }
        });
    Map<Outcome, Integer> counts = new EnumMap<>(Outcome.class);
    int processed = 0;
    for (Target t : targets) {
      if (!deadline.allowsOrWarn(
          perCall, log, "프로젝트 리포트 회차 시간 예산 소진 — 남은 프로젝트 {}건은 다음 회차에", targets.size() - processed)) {
        break;
      }
      processed++;
      TenantContext.set(t.tenantId());
      Outcome outcome;
      try {
        outcome = generator.run(t.projectId(), OffsetDateTime.now(runClock));
      } catch (RuntimeException e) {
        log.warn(
            "프로젝트 리포트 실패 tenant={} projectId={}: {}", t.tenantId(), t.projectId(), e.toString());
        outcome = Outcome.FAILED;
      } finally {
        TenantContext.clear();
      }
      counts.merge(outcome, 1, Integer::sum);
    }
    return new Summary(
        processed,
        counts.getOrDefault(Outcome.GENERATED, 0),
        counts.getOrDefault(Outcome.FAILED, 0));
  }
}
