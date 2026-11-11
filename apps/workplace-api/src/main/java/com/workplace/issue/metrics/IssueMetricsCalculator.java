package com.workplace.issue.metrics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.issue.dto.IssueDueWindow;
import com.workplace.issue.metrics.IssueMetricsRepository.ClosedCandidate;
import com.workplace.issue.metrics.IssueMetricsRepository.HistoryEvent;
import com.workplace.user.dto.UserKind;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Predicate;
import java.util.stream.Stream;
import lombok.extern.slf4j.Slf4j;

/**
 * 성과 지표의 순수 계산(WP-1476) — DB·스프링 없이 원재료(후보 이슈·이력·담당자·agent_work)만 받아 이슈별 사실과 요약·칸을 만든다. 정의가 까다로운
 * 부분(닫힐 때 담당자, 닫힐 당시 마감일, AI와 함께, 서울 날짜 칸)을 여기 모아 단위 테스트로 경계를 촘촘히 고정한다.
 *
 * <p>이력 payload 가 깨졌거나 모양이 다르면 예외를 던지지 않고 그 행만 건너뛴다(debug 로그) — 옛 데이터 한 줄 때문에 지표 화면 전체가 500 이 되지
 * 않게.
 */
@Slf4j
public final class IssueMetricsCalculator {

  /** payload 파싱 전용 — readTree 만 쓰므로 기본 설정으로 충분하고, 공유해도 스레드 안전하다. */
  private static final ObjectMapper JSON = new ObjectMapper();

  /** 하루 초 — 소요 일수 = 초 / 86400.0(반올림 없음). */
  private static final double SECONDS_PER_DAY = 86_400.0;

  private IssueMetricsCalculator() {}

  /**
   * 파싱한 담당자 변경 한 건 — 들어온·빠진 사람의 user id. payload 의 kind 는 쓰지 않는다: 사람의 종류(HUMAN/AGENT)는 그 사람의 속성이라 한
   * 번의 {@code "user".kind} 조회로 정하고, 옛 행에 kind 가 없거나 달라도 판정이 흔들리지 않게 한다.
   */
  public record AssigneeChange(OffsetDateTime at, List<Long> added, List<Long> removed) {
    /** 이 변경에 나오는 모든 사람(들어온 ++ 빠진). */
    public Stream<Long> userIds() {
      return Stream.concat(added.stream(), removed.stream());
    }
  }

  /**
   * 파싱한 마감일 변경 한 건. {@code to} 가 null 이면 「마감을 지웠다」는 뜻이다 — 「행이 없다」와 구분해야 해서 행 자체를 남긴다(행이 없으면 다음 규칙으로
   * 넘어가지만, 지운 행이 있으면 닫힐 당시 마감 없음).
   */
  public record DueChange(OffsetDateTime at, LocalDate from, LocalDate to) {}

  /**
   * 이슈 한 건의 계산 입력.
   *
   * @param candidate 완료 후보 원재료
   * @param assigneeChanges 담당자 변경(시각·id 오름차순)
   * @param dueChanges 마감일 변경(시각·id 오름차순)
   * @param currentAssignees 현재 담당자 user id
   * @param firstAgentRunAt AI 가 처음 실제로 일한 시각(없으면 null) — 착수 전 SUBMITTED·착수 전 취소는 제외(저장소 ④ 참조)
   */
  public record IssueInput(
      ClosedCandidate candidate,
      List<AssigneeChange> assigneeChanges,
      List<DueChange> dueChanges,
      Set<Long> currentAssignees,
      OffsetDateTime firstAgentRunAt) {}

  /** 이슈 한 건의 평가 결과 — 사실과, 사람 기준 판정에 쓰는 닫힐 때 담당자 user id. */
  public record Evaluated(ClosedIssueFact fact, Set<Long> assigneesAtClose) {}

  // ---------------------------------------------------------------- 파싱

  /**
   * ASSIGNEES_CHANGED 행을 파싱한다. payload 는 {@code
   * {"added":[{id,username,name,kind}],"removed":[...]}}(+ 자동 지정이면 reason 등 여분 키) — id 만 읽는다. JSON
   * 이 깨졌거나 added/removed 가 배열이 아니거나 id 가 없으면 그 행(또는 그 사람)을 건너뛴다.
   */
  public static Optional<AssigneeChange> parseAssigneeChange(HistoryEvent e) {
    if (e.toValue() == null || e.toValue().isBlank()) return Optional.empty();
    try {
      JsonNode root = JSON.readTree(e.toValue());
      if (root == null || !root.isObject()) {
        log.debug("담당자 변경 이력 payload 가 객체가 아니라 건너뜀: historyId={}", e.id());
        return Optional.empty();
      }
      return Optional.of(
          new AssigneeChange(e.createdAt(), ids(root.get("added")), ids(root.get("removed"))));
    } catch (Exception ex) {
      log.debug("담당자 변경 이력 payload 파싱 실패로 건너뜀: historyId={}", e.id(), ex);
      return Optional.empty();
    }
  }

  /** payload 배열 → user id 목록. 배열이 아니면 빈 목록, id 가 숫자가 아닌 원소는 건너뛴다. */
  private static List<Long> ids(JsonNode arr) {
    List<Long> out = new ArrayList<>();
    if (arr == null || !arr.isArray()) return out;
    for (JsonNode n : arr) {
      JsonNode id = n.get("id");
      if (id != null && id.canConvertToLong()) out.add(id.asLong());
    }
    return out;
  }

  /**
   * DUE_DATE_CHANGED 행을 파싱한다. 값은 {@code LocalDate.toString()} 또는 null/빈 문자열. 날짜 모양이 아니면 그 행을 건너뛴다.
   */
  public static Optional<DueChange> parseDueChange(HistoryEvent e) {
    try {
      return Optional.of(new DueChange(e.createdAt(), date(e.fromValue()), date(e.toValue())));
    } catch (DateTimeParseException ex) {
      log.debug("마감일 변경 이력 값이 날짜가 아니라 건너뜀: historyId={}", e.id());
      return Optional.empty();
    }
  }

  private static LocalDate date(String v) {
    return v == null || v.isBlank() ? null : LocalDate.parse(v.trim());
  }

  // ---------------------------------------------------------------- 이슈 한 건

  /** 시각의 서울 날짜. JVM 기본 zone(UTC)에 기대지 않는다. */
  public static LocalDate seoulDate(OffsetDateTime t) {
    return t.atZoneSameInstant(IssueDueWindow.ZONE).toLocalDate();
  }

  /**
   * 닫힐 때 담당자를 재구성한다 — 현재 담당자에서 시작해 closed_at <b>뒤</b>(엄격히 큼) 담당자 변경을 최신부터 거꾸로 되돌린다(added 는 빼고,
   * removed 는 넣는다). 이력이 없으면 현재 담당자 그대로. 옛 단일 담당 ASSIGNEE_CHANGED 는 입력에 오지 않는다(모양이 달라 재구성에 쓰지 않음).
   *
   * @return 닫힐 때 담당자 user id(삽입 순서 유지)
   */
  public static Set<Long> assigneesAtClose(IssueInput in) {
    Set<Long> set = new LinkedHashSet<>(in.currentAssignees());
    OffsetDateTime closedAt = in.candidate().closedAt();
    List<AssigneeChange> changes = in.assigneeChanges();
    for (int i = changes.size() - 1; i >= 0; i--) {
      AssigneeChange c = changes.get(i);
      if (!c.at().isAfter(closedAt)) break; // 오름차순이라 여기부터는 모두 닫히기 전
      c.added().forEach(set::remove);
      set.addAll(c.removed());
    }
    return set;
  }

  /**
   * 닫힐 당시 마감일 — closed_at 이하 마지막 변경의 to(null 이면 지운 것 → 마감 없음). 그런 행이 없으면 closed_at 뒤 첫 변경의
   * from(그때까지 유지된 값). 이력이 아예 없으면 현재 마감일.
   */
  public static LocalDate dueAtClose(IssueInput in) {
    OffsetDateTime closedAt = in.candidate().closedAt();
    DueChange lastBefore = null;
    DueChange firstAfter = null;
    for (DueChange d : in.dueChanges()) {
      if (!d.at().isAfter(closedAt)) {
        lastBefore = d;
      } else if (firstAfter == null) {
        firstAfter = d;
      }
    }
    if (lastBefore != null) return lastBefore.to();
    if (firstAfter != null) return firstAfter.from();
    return in.candidate().currentDueDate();
  }

  /**
   * AI와 함께 — (a) 닫힐 때 담당자에 AGENT, (b) closed_at 이하 담당자 변경의 added 또는 removed 에 AGENT, (c) AI 가
   * closed_at 이하에 실제로 일함 중 하나. 닫힌 뒤에 시작한 AI 작업·닫힌 뒤 배정은 세지 않는다.
   *
   * <p>(b) 에 removed 도 보는 이유: 이슈를 만들 때 넣은 담당자는 ASSIGNEES_CHANGED 행이 없다. 그런 AI 담당자가 닫히기 전에 빠지면 남는
   * 흔적은 removed 뿐인데, 빠졌다는 것은 그 전에 담당이었다는 증거다.
   *
   * @param kinds user id → {@code "user".kind}(이력·현재 담당자에 나오는 사람 전부). 없는 사람은 AGENT 로 보지 않는다
   */
  public static boolean withAi(IssueInput in, Set<Long> atClose, Map<Long, String> kinds) {
    Predicate<Long> isAgent = id -> UserKind.AGENT.equals(kinds.get(id));
    if (atClose.stream().anyMatch(isAgent)) return true;
    OffsetDateTime closedAt = in.candidate().closedAt();
    for (AssigneeChange c : in.assigneeChanges()) {
      if (c.at().isAfter(closedAt)) break;
      if (c.userIds().anyMatch(isAgent)) return true;
    }
    return in.firstAgentRunAt() != null && !in.firstAgentRunAt().isAfter(closedAt);
  }

  /**
   * 이슈 한 건을 평가한다 — 마감 판정·늦은 날수·소요·AI와 함께와 닫힐 때 담당자.
   *
   * @param kinds user id → {@code "user".kind}({@link #withAi} 참조)
   */
  public static Evaluated evaluate(IssueInput in, Map<Long, String> kinds) {
    ClosedCandidate c = in.candidate();
    LocalDate closedDate = seoulDate(c.closedAt());
    LocalDate due = dueAtClose(in);
    DueOutcome outcome;
    Integer lateDays = null;
    if (due == null) {
      outcome = DueOutcome.NO_DUE;
    } else if (!closedDate.isAfter(due)) {
      outcome = DueOutcome.ON_TIME;
    } else {
      outcome = DueOutcome.OVERDUE;
      lateDays = (int) ChronoUnit.DAYS.between(due, closedDate);
    }
    // 소요가 음수(closed_at < created_at)면 잘못 들어온 데이터(가져오기 시각 오류 등)다 — 평균·중간값을 깎지 않게 null 로 두고 집계에서 뺀다.
    double rawLeadTime =
        Duration.between(c.createdAt(), c.closedAt()).getSeconds() / SECONDS_PER_DAY;
    Double leadTime = rawLeadTime < 0 ? null : rawLeadTime;
    Set<Long> atClose = assigneesAtClose(in);
    boolean ai = withAi(in, atClose, kinds);
    return new Evaluated(
        new ClosedIssueFact(
            c.issueId(),
            c.projectId(),
            c.closedAt(),
            closedDate,
            due,
            outcome,
            lateDays,
            leadTime,
            ai),
        atClose);
  }

  // ---------------------------------------------------------------- 묶음

  /** 닫힌 시각 내림차순(같으면 id 내림차순) — 화면 목록의 기본 순서. */
  public static final Comparator<ClosedIssueFact> CLOSED_DESC =
      Comparator.comparing(ClosedIssueFact::closedAt)
          .thenComparingLong(ClosedIssueFact::issueId)
          .reversed();

  /** 완료 사실과 생성 수로 한 기간 요약을 만든다. 분모가 0 인 지표는 null. */
  public static MetricsSummary summarize(List<ClosedIssueFact> facts, int created) {
    int withAi = 0;
    int onTime = 0;
    int overdue = 0;
    int noDue = 0;
    long lateSum = 0;
    List<Double> leads = new ArrayList<>(facts.size());
    for (ClosedIssueFact f : facts) {
      if (f.withAi()) withAi++;
      switch (f.outcome()) {
        case ON_TIME -> onTime++;
        case OVERDUE -> {
          overdue++;
          lateSum += f.lateDays();
        }
        case NO_DUE -> noDue++;
      }
      if (f.leadTimeDays() != null) leads.add(f.leadTimeDays()); // 음수 소요(null)는 평균·중간값에서 뺀다
    }
    Double lateAvg = overdue == 0 ? null : (double) lateSum / overdue;
    Double rate = onTime + overdue == 0 ? null : (double) onTime / (onTime + overdue);
    // 한 번 정렬해 평균과 중간값을 같은 목록에서 구한다.
    leads.sort(null);
    Double leadAvg =
        leads.isEmpty() ? null : leads.stream().mapToDouble(d -> d).average().orElseThrow();
    return new MetricsSummary(
        facts.size(),
        withAi,
        created,
        onTime,
        overdue,
        noDue,
        lateAvg,
        rate,
        leadAvg,
        medianOfSorted(leads));
  }

  /** 오름차순 정렬된 목록의 중간값 — 짝수 개면 가운데 두 값의 평균, 비면 null. 정렬은 호출자가 한다(복사·재정렬 없음). */
  public static Double medianOfSorted(List<Double> sorted) {
    if (sorted.isEmpty()) return null;
    int n = sorted.size();
    return n % 2 == 1 ? sorted.get(n / 2) : (sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2.0;
  }

  /**
   * 기간을 칸으로 자르고 완료·초과·생성 수를 채운다. 빈 칸도 0 으로 남긴다. WEEK 는 월요일 시작, MONTH 는 달력 월이고 기간 경계에서 잘린 칸은 기간 안
   * 부분만 덮는다. 기간 밖 날짜는 무시한다.
   */
  public static List<MetricsBucket> buckets(
      MetricsPeriod period,
      MetricsGranularity g,
      List<ClosedIssueFact> facts,
      List<LocalDate> createdDates) {
    List<LocalDate[]> ranges = new ArrayList<>();
    LocalDate cursor = period.from();
    while (!cursor.isAfter(period.to())) {
      LocalDate naturalEnd =
          switch (g) {
            case DAY -> cursor;
            case WEEK -> cursor.with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY));
            case MONTH -> cursor.with(TemporalAdjusters.lastDayOfMonth());
          };
      LocalDate end = naturalEnd.isAfter(period.to()) ? period.to() : naturalEnd;
      ranges.add(new LocalDate[] {cursor, end});
      cursor = end.plusDays(1);
    }
    int[] completed = new int[ranges.size()];
    int[] overdue = new int[ranges.size()];
    int[] created = new int[ranges.size()];
    Map<LocalDate, Integer> indexByDay = new HashMap<>();
    for (int i = 0; i < ranges.size(); i++) {
      for (LocalDate d = ranges.get(i)[0]; !d.isAfter(ranges.get(i)[1]); d = d.plusDays(1)) {
        indexByDay.put(d, i);
      }
    }
    for (ClosedIssueFact f : facts) {
      Integer i = indexByDay.get(f.closedDate());
      if (i == null) continue;
      completed[i]++;
      if (f.outcome() == DueOutcome.OVERDUE) overdue[i]++;
    }
    for (LocalDate d : createdDates) {
      Integer i = indexByDay.get(d);
      if (i != null) created[i]++;
    }
    List<MetricsBucket> out = new ArrayList<>(ranges.size());
    for (int i = 0; i < ranges.size(); i++) {
      out.add(
          new MetricsBucket(
              ranges.get(i)[0], ranges.get(i)[1], completed[i], overdue[i], created[i]));
    }
    return out;
  }
}
