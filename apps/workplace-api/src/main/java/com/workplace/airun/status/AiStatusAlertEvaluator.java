package com.workplace.airun.status;

import com.workplace.airun.status.dto.AiStatusAlert;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * AI 현황 경고 판정(WP-1831) — DB·시계에 기대지 않는 순수 규칙이라 입력만으로 결과가 정해진다. 「최근 표본」이 없는 항목(대기 시간 null·계정 빈 목록)은
 * 호출자가 비워서 주며, 그러면 해당 경고는 만들지 않는다(낡은 값으로 경고하지 않기 위해).
 */
public final class AiStatusAlertEvaluator {

  private static final String WARNING = "WARNING";
  private static final String DANGER = "DANGER";

  /** 실패 경고의 최소 실패 건수. */
  private static final long MIN_FAILED = 10;

  /** 실패율이 직전 기간의 몇 배 이상이면 경고하는지. */
  private static final double RATE_MULTIPLE = 3.0;

  /** 부동소수점 곱셈 오차(0.1*3=0.30000000000000004)로 경계값이 빠지지 않게 하는 허용치. */
  private static final double EPS = 1e-9;

  /** 최장 대기 경고 기준(초). */
  private static final int QUEUE_WAIT_SEC = 1800;

  /** 계정 사용량 경고·위험 기준(%). */
  private static final double USAGE_WARN = 80.0;

  private static final double USAGE_DANGER = 100.0;

  /** 밀린 건수가 이 시간 동안 줄지 않으면 적체로 본다. */
  private static final Duration STUCK_FOR = Duration.ofMinutes(60);

  private AiStatusAlertEvaluator() {}

  /** 작업 종류별 실패 집계(rate·previousRate 는 실패율, 직전 기간 표본이 없으면 previousRate=null). */
  public record KindFailure(String kind, long failed, Double rate, Double previousRate) {}

  /** AI 계정의 사용량 한 줄(window 는 5h·7d 같은 한도 창 이름). */
  public record AccountUsagePoint(
      long accountId, String label, String window, double usedPercent) {}

  /** 한 시각의 종류별 밀린 건수 표본. */
  public record BacklogPoint(Instant sampledAt, Map<String, Integer> backlog) {}

  /**
   * 경고를 판정한다. 순서는 KIND_FAILURE → QUEUE_WAIT → ACCOUNT_USAGE → BACKLOG_STUCK.
   *
   * @param kinds 종류별 실패 집계
   * @param queueOldestWaitSec 최근 표본의 최장 대기(초), 최근 표본이 없으면 null
   * @param accounts 최근 표본의 계정 사용량, 없으면 빈 목록
   * @param backlogLast70m 최근 70분의 밀린 건수 표본
   * @param now 판정 기준 시각
   */
  public static List<AiStatusAlert> evaluate(
      List<KindFailure> kinds,
      Integer queueOldestWaitSec,
      List<AccountUsagePoint> accounts,
      List<BacklogPoint> backlogLast70m,
      Instant now) {
    List<AiStatusAlert> out = new ArrayList<>();

    // 1) 종류별 실패 급증 — 10건 이상이면서 직전보다 3배 이상(직전 없음·0 이면 건수만으로).
    for (KindFailure k : kinds) {
      if (k.failed() < MIN_FAILED) {
        continue;
      }
      boolean prevNone = k.previousRate() == null || k.previousRate() == 0.0;
      boolean surged =
          prevNone || (k.rate() != null && k.rate() + EPS >= k.previousRate() * RATE_MULTIPLE);
      if (surged) {
        out.add(
            new AiStatusAlert(
                "KIND_FAILURE",
                DANGER,
                k.kind(),
                null,
                null,
                k.rate(),
                prevNone ? null : k.previousRate() * RATE_MULTIPLE));
      }
    }

    // 2) 최장 대기 30분 이상.
    if (queueOldestWaitSec != null && queueOldestWaitSec >= QUEUE_WAIT_SEC) {
      out.add(
          new AiStatusAlert(
              "QUEUE_WAIT",
              WARNING,
              null,
              null,
              null,
              queueOldestWaitSec.doubleValue(),
              (double) QUEUE_WAIT_SEC));
    }

    // 3) 계정 사용량 — 80% 이상 주의, 100% 이상 위험.
    for (AccountUsagePoint a : accounts) {
      if (a.usedPercent() >= USAGE_WARN) {
        boolean danger = a.usedPercent() >= USAGE_DANGER;
        out.add(
            new AiStatusAlert(
                "ACCOUNT_USAGE",
                danger ? DANGER : WARNING,
                null,
                a.accountId(),
                a.label() + " · " + a.window(),
                a.usedPercent(),
                danger ? USAGE_DANGER : USAGE_WARN));
      }
    }

    // 4) 밀린 건수가 60분 동안 줄지 않음.
    out.addAll(stuckBacklog(backlogLast70m, now));
    return out;
  }

  /**
   * 적체 판정 — 60분 전(포함) 이전의 가장 늦은 표본을 기준값 v0 로 잡고, 그 뒤 표본의 최솟값이 v0 이상이며 v0 와 가장 최근 값이 모두 0 보다 클 때만
   * 경고한다. v0 표본이 없으면 60분을 덮지 못한 것이므로 판정하지 않는다.
   */
  private static List<AiStatusAlert> stuckBacklog(List<BacklogPoint> points, Instant now) {
    List<AiStatusAlert> out = new ArrayList<>();
    if (points.isEmpty()) {
      return out;
    }
    List<BacklogPoint> sorted =
        points.stream().sorted(Comparator.comparing(BacklogPoint::sampledAt)).toList();
    Instant cutoff = now.minus(STUCK_FOR);
    BacklogPoint base = null;
    List<BacklogPoint> after = new ArrayList<>();
    for (BacklogPoint p : sorted) {
      if (!p.sampledAt().isAfter(cutoff)) {
        base = p;
      } else {
        after.add(p);
      }
    }
    if (base == null || after.isEmpty()) {
      return out;
    }
    BacklogPoint latest = after.get(after.size() - 1);
    // 표본에 나온 모든 종류를 이름순으로 본다 — 결과 순서를 고정하려는 것.
    TreeSet<String> kinds = new TreeSet<>(base.backlog().keySet());
    for (BacklogPoint p : after) {
      kinds.addAll(p.backlog().keySet());
    }
    for (String kind : kinds) {
      int v0 = base.backlog().getOrDefault(kind, 0);
      int current = latest.backlog().getOrDefault(kind, 0);
      // v0=0(기준 표본에 없거나 0)은 「줄지 않음」이 아니라 새로 생긴 적체라 제외한다.
      if (current <= 0 || v0 <= 0) {
        continue;
      }
      boolean neverDecreased =
          after.stream().allMatch(p -> p.backlog().getOrDefault(kind, 0) >= v0);
      if (neverDecreased) {
        out.add(
            new AiStatusAlert(
                "BACKLOG_STUCK", WARNING, kind, null, null, (double) current, (double) v0));
      }
    }
    return out;
  }
}
