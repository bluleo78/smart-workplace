package com.workplace.wiki.report;

import com.workplace.airun.AiCallTimeouts;
import com.workplace.airun.RoundDeadline;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.issue.outbound.IssueAiConfig;
import com.workplace.wiki.report.PersonalReportGenerator.Outcome;
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
 * 개인 일일 보고 실행기(WP-1486) — 5분마다, 일일 보고를 켜 두었고 다음 실행 시각이 된 사람의 어제 보고를 차례로 만든다. 시각(KST 정시)은 사람마다
 * {@code next_run_at} 이 맡으므로 이 간격은 「얼마나 늦게 알아채도 되나」만 정한다(최대 5분 늦음, P13). {@link
 * ProjectReportScheduler} 와 같은 모양이다.
 *
 * <p><b>비서:</b> 프로젝트 리포트와 달리 테넌트 단위로 공통 비서를 거르지 않는다 — 개인 비서 → 공용 비서 순으로 사람마다 다르므로 생성기가 사람별로 {@code
 * AssistantResolver.resolveOrEmpty(userId)} 로 확인하고, 없으면 그날을 건너뛴다.
 *
 * <p><b>겹침 방지:</b> 여러 파드는 ShedLock 으로 한 번만 돈다. 회차가 잠금 시간(40분)을 넘겨 풀려도 생성기의 실행권 잡기(next_run_at 조건부
 * 갱신)와 자동 회차 unique 가 같은 날 보고를 두 번 만들지 않게 막는다.
 *
 * <p><b>처리 상한:</b> 한 회차는 {@link #MAX_PER_RUN} 명까지만 처리하고 나머지는 다음 회차로 — 한 편마다 AI 가 긴 글을 쓰므로 한 회차가 잠금
 * 시간을 넘지 않게 묶는다(P12).
 *
 * <p><b>트랜잭션:</b> 러너 트랜잭션 안에서는 (테넌트, 사람) 목록만 모은다. 생성기는 트랜잭션 밖에서 불러야 하므로(AI 호출·본문 쓰기를 트랜잭션에 묶지 않는다)
 * 목록은 러너가 끝난 뒤 하나씩 TenantContext 를 세워 이 스레드에서 처리하고, 끝나면 반드시 비운다. 한 사람의 실패는 경고만 남기고 다음으로 넘어간다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PersonalReportScheduler {

  /** 한 회차에 처리하는 사람 수 상한(모든 테넌트 합계). */
  static final int MAX_PER_RUN = 10;

  private final TenantScopedRunner tenantRunner;
  private final PersonalReportSettingRepository settings;
  private final PersonalReportGenerator generator;
  private final AiAgentProperties aiAgentProperties;

  /** AI 호출 실행 상한 표(WP-2111) — 회차 시간 예산에서 한 건의 최악 시간을 계산한다. */
  private final AiCallTimeouts timeouts;

  /** 잠금 최대 — @SchedulerLock 의 lockAtMostFor 와 회차 마감 계산이 함께 쓰는 한 값. */
  static final String LOCK_AT_MOST_FOR = "PT40M";

  /** 잠금 최대 Duration — {@link #LOCK_AT_MOST_FOR} 를 파싱한 값. */
  static final Duration LOCK_AT_MOST = Duration.parse(LOCK_AT_MOST_FOR);

  /** 「지금」의 기준 시계. */
  private final Clock clock = Clock.systemUTC();

  /** 한 테넌트의 대상 사람 하나. */
  private record Target(long tenantId, long userId) {}

  /**
   * 한 회차 집계.
   *
   * @param processed 대상 사람 수(결과와 상관없이)
   * @param generated 보고 페이지를 새로 만듦
   * @param failed 실패(30분 뒤 재시도 또는 다음 날로 넘김)
   */
  public record Summary(int processed, int generated, int failed) {}

  /** 5분마다(기동 2분 뒤 시작) — 때가 된 사람의 일일 보고를 만든다. */
  @Scheduled(fixedDelay = 300_000, initialDelay = 120_000)
  @SchedulerLock(name = "PersonalReportScheduler.runOnce", lockAtMostFor = LOCK_AT_MOST_FOR)
  public void runOnce() {
    Summary s = runOnce(clock);
    if (s.processed() > 0) {
      log.info("개인 일일 보고 — 대상 {}명: 새로 씀 {} · 실패 {}", s.processed(), s.generated(), s.failed());
    }
  }

  /** 한 회차(테스트·수동 실행 진입점). 「지금」은 사람마다 시계에서 다시 읽는다(회차가 길어져도 뒤쪽 사람의 기준이 회차 시작 시각에 묶이지 않게). */
  public Summary runOnce(Clock runClock) {
    return runOnce(runClock, MAX_PER_RUN);
  }

  /**
   * 처리 상한을 받는 한 회차 — 상한은 테넌트별이 아니라 전체 합계로 자른다(테넌트 순서 → 다음 실행이 이른 순). 처리한 사람은 다음 실행 시각이 밀리므로 남은 사람이
   * 다음 회차 앞쪽에 온다.
   */
  Summary runOnce(Clock runClock, int limit) {
    // 회차 시간 예산(WP-2111) — 회차 시작(잠금 직후, 대상 수집 전)에 마감을 잡는다(수집도 잠금 안에서 흐른다).
    // 건당 최악은 리포트 클라이언트 읽기 상한(IssueAiConfig#reportReadTimeout) — 같은 클라이언트가 나르는 항목 최대 + 여유라, ai-agent
    // 가 상한을 지키지 않아도 HTTP 가 그만큼만 기다린다. 다음 건은 그 최악이 마감 안에 끝날
    // 때만 시작한다(개수 상한만으로는 상한을 덮어쓰면 잠금을 넘는다). 남은 대상은 다음 실행 시각이 그대로라 다음 회차 앞쪽에 온다.
    RoundDeadline deadline = RoundDeadline.underLock(runClock, LOCK_AT_MOST);
    Duration perCall = IssueAiConfig.reportReadTimeout(timeouts);
    // AI 연동이 꺼져 있으면 회차를 열지 않는다(WP-1639) — 설정 상태를 실패로 세지 않게. 대상의 다음 실행 시각은 그대로 남아 다시 켜면 이어 만든다.
    if (!aiAgentProperties.enabled()) return new Summary(0, 0, 0);
    OffsetDateTime now = OffsetDateTime.now(runClock);
    List<Target> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          if (targets.size() >= limit) return;
          for (Long userId : settings.dueUserIds(now, limit - targets.size())) {
            targets.add(new Target(tenantId, userId));
          }
        });
    Map<Outcome, Integer> counts = new EnumMap<>(Outcome.class);
    int processed = 0;
    // 러너 트랜잭션이 끝난 뒤 — 생성기는 트랜잭션 밖에서 돈다.
    for (Target t : targets) {
      if (!deadline.allowsOrWarn(
          perCall, log, "개인 일일 보고 회차 시간 예산 소진 — 남은 사람 {}건은 다음 회차에", targets.size() - processed)) {
        break;
      }
      processed++;
      TenantContext.set(t.tenantId());
      Outcome outcome;
      try {
        outcome = generator.runDaily(t.userId(), OffsetDateTime.now(runClock));
      } catch (RuntimeException e) {
        log.warn("개인 일일 보고 실패 tenant={} userId={}: {}", t.tenantId(), t.userId(), e.toString());
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
