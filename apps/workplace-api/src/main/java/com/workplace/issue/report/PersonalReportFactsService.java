package com.workplace.issue.report;

import static com.workplace.issue.report.ReportNumbers.DASH;
import static com.workplace.issue.report.ReportNumbers.diff;
import static com.workplace.issue.report.ReportNumbers.num;

import com.workplace.issue.dto.IssueDueWindow;
import com.workplace.issue.metrics.ClosedIssueFact;
import com.workplace.issue.metrics.IssueMetrics;
import com.workplace.issue.metrics.IssueMetricsService;
import com.workplace.issue.metrics.MetricsGranularity;
import com.workplace.issue.metrics.MetricsPeriod;
import com.workplace.issue.metrics.MetricsSummary;
import com.workplace.issue.report.PersonalReportIssueRepository.EpicProject;
import com.workplace.issue.repository.MeOverviewRepository;
import com.workplace.issue.repository.MeOverviewRepository.OpenIssueRow;
import com.workplace.wiki.report.ReportTableSpec;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개인 보고 계산값(WP-1486) — 숫자 표와 AI 재료 이슈를 시스템이 정한다. 숫자는 새로 세지 않고 「내 작업 · 개요」와 같은 정의를 그대로 쓴다: 끝냄·그중 AI와
 * 함께·기한 내·기한 초과·새로 만듦·평균 소요는 지표 모듈({@link IssueMetricsService#forMe}), 기한 지남(지금)·답변 필요·오늘 마감은 개요의
 * 열린 이슈({@link MeOverviewRepository#findOpenIssues}) — 보고의 「어제」와 개요의 「어제」 칸이 같은 숫자가 나오게. 상태 바꿈만 새
 * 쿼리({@link PersonalReportIssueRepository#statusChangedIssueIds})로 센다(개요에 없는 숫자).
 *
 * <p>권한 검사 없이 userId 만으로 돈다 — 범위는 「지금 그 사람이 읽을 수 있는 프로젝트」 조건이 쿼리마다 걸려 있다. 보고 생성기·스케줄러(본인 회차) 전용이다.
 */
@Service
@RequiredArgsConstructor
public class PersonalReportFactsService {

  /** AI 재료 이슈 상한 — 생성 비용 상한(넘치면 에픽·프로젝트별 남은 건수로 요약). 프로젝트 리포트(60)보다 작다. */
  public static final int ISSUE_LIMIT = 40;

  /** 주간·월간에 덧붙이는 진행 중 이슈(위 이유에 안 든 내 담당 열린 이슈) 건수 — 최근에 움직인 순. */
  public static final int OPEN_LIMIT = 10;

  /** 일일 표 머리 첫 칸 판정 — 「끝냄」. */
  public static final Predicate<String> DAILY_HEAD = "끝냄"::equals;

  /** 주간·월간 표 머리 첫 칸 판정 — AI 가 주간 템플릿을 월간에 그대로 써도 같은 표로 알아본다. */
  public static final Predicate<String> PERIOD_HEAD =
      s -> s.startsWith("지난주 대비") || s.startsWith("지난달 대비");

  /** 일일 표를 둘 섹션 제목. */
  static final String DAILY_SECTION = "어제 숫자";

  /** 표를 넣을 자리 — 이 섹션 뒤. */
  static final String AFTER_SECTION = "한 줄";

  private final IssueMetricsService metricsService;
  private final MeOverviewRepository overviewRepository;
  private final PersonalReportIssueRepository issueRepository;
  private final ReportIssueDetails details;

  /**
   * 한 회차의 계산값을 만든다.
   *
   * @param userId 보고 주인(본인)
   * @param period 회차
   * @param now 「지금」 — 기한 지남·답변 필요·오늘 마감은 이 시각의 서울 날짜 기준
   */
  @Transactional(readOnly = true)
  public PersonalReportFacts compute(long userId, PersonalReportPeriod period, OffsetDateTime now) {
    LocalDate today = IssueDueWindow.seoulDate(now);
    IssueMetrics metrics = metricsService.forMe(userId, period.toMetrics(), MetricsGranularity.DAY);
    MetricsSummary cur = metrics.current();
    List<Long> statusChanged = issueRepository.statusChangedIssueIds(userId, period);
    List<OpenIssueRow> open = overviewRepository.findOpenIssues(userId);
    int overdueNow = (int) open.stream().filter(r -> overdue(r, today)).count();

    ReportTableSpec table =
        switch (period.kind()) {
          case DAILY -> dailySpec(cur, statusChanged.size(), overdueNow);
          // 주간은 같은 길이 바로 앞 기간이 곧 지난주라 한 번에 센 값을, 월간은 길이가 다른 지난 달력 달을 따로 센다(프로젝트 MONTHLY 와 같은 처리).
          case WEEKLY -> periodSpec(period.kind(), cur, metrics.previous(), overdueNow);
          case MONTHLY -> periodSpec(period.kind(), cur, previousMonth(userId, period), overdueNow);
        };

    // forMe 의 closedIssues 는 closedIssuesForMe 와 같은 정의·같은 결과라 다시 묻지 않는다.
    List<ReportIssueDetails.Candidate> all =
        candidates(userId, period, today, open, metrics.closedIssues(), statusChanged);
    List<ReportIssueDetails.Candidate> shown = all.subList(0, Math.min(ISSUE_LIMIT, all.size()));
    List<ReportIssueDetails.Candidate> rest = all.subList(shown.size(), all.size());

    return new PersonalReportFacts(
        period,
        table,
        details.details(shown),
        ReportIssueDetails.countByGroup(rest),
        cur.completed(),
        cur.created(),
        statusChanged.size());
  }

  /** 월간 비교 대상 — 지난 달력 달(1일~말일)의 지표. */
  private MetricsSummary previousMonth(long userId, PersonalReportPeriod period) {
    YearMonth prev = YearMonth.from(period.start()).minusMonths(1);
    return metricsService
        .forMe(
            userId, new MetricsPeriod(prev.atDay(1), prev.atEndOfMonth()), MetricsGranularity.DAY)
        .current();
  }

  /** 개요와 같은 「기한 지남」 판정 — 내가 담당이고 마감일이 오늘보다 앞. */
  private static boolean overdue(OpenIssueRow r, LocalDate today) {
    return r.assignedToMe() && r.dueDate() != null && r.dueDate().isBefore(today);
  }

  /**
   * AI 재료 후보를 이유 순서로 모은다 — OVERDUE → WAITING → DUE_TODAY → DONE → STATUS_CHANGED → CREATED →
   * (주간·월간) OPEN. 한 이슈는 처음 든 이유 하나로만 싣는다. 묶음 안 순서: 기한 지남은 마감 오래된 순(개요와 같음), 답변 필요는 오래 기다린 순, 끝냄은 닫힌
   * 최신순, 상태 바꿈·만듦은 최신순, 진행 중은 최근에 움직인 순.
   */
  private List<ReportIssueDetails.Candidate> candidates(
      long userId,
      PersonalReportPeriod period,
      LocalDate today,
      List<OpenIssueRow> open,
      List<ClosedIssueFact> closed,
      List<Long> statusChanged) {
    Set<Long> seen = new HashSet<>();
    List<ReportIssueDetails.Candidate> out = new ArrayList<>();

    Comparator<OpenIssueRow> byDue =
        Comparator.comparing(OpenIssueRow::dueDate).thenComparing(OpenIssueRow::issueId);
    open.stream()
        .filter(r -> overdue(r, today))
        .sorted(byDue)
        .forEach(r -> add(out, seen, pending(r.issueId(), "OVERDUE", r.dueDate())));
    open.stream()
        .filter(OpenIssueRow::waiting)
        .sorted(
            Comparator.comparing(
                    OpenIssueRow::waitingSince, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(OpenIssueRow::issueId))
        .forEach(r -> add(out, seen, pending(r.issueId(), "WAITING", r.dueDate())));
    open.stream()
        .filter(r -> r.assignedToMe() && today.equals(r.dueDate()))
        .sorted(Comparator.comparing(OpenIssueRow::issueId))
        .forEach(r -> add(out, seen, pending(r.issueId(), "DUE_TODAY", r.dueDate())));
    for (ClosedIssueFact f : closed) {
      add(
          out,
          seen,
          new ReportIssueDetails.Candidate(
              f.issueId(), "DONE", null, null, null, f.lateDays(), f.withAi()));
    }
    for (Long id : statusChanged) {
      add(out, seen, pending(id, "STATUS_CHANGED", null));
    }
    for (ReportIssueDetails.Candidate c : issueRepository.createdCandidates(userId, period)) {
      add(out, seen, c);
    }
    if (period.kind() != PersonalReportKind.DAILY) {
      open.stream()
          .filter(r -> r.assignedToMe() && !seen.contains(r.issueId()))
          .sorted(
              Comparator.comparing(
                      OpenIssueRow::updatedAt, Comparator.nullsLast(Comparator.reverseOrder()))
                  .thenComparing(OpenIssueRow::issueId, Comparator.reverseOrder()))
          .limit(OPEN_LIMIT)
          .forEach(r -> add(out, seen, pending(r.issueId(), "OPEN", r.dueDate())));
    }
    return withGroups(out);
  }

  /** 에픽·묶음을 아직 모르는 후보(지표 모듈·개요에서 온 것) — {@link #withGroups} 가 채운다. */
  private static ReportIssueDetails.Candidate pending(long id, String reason, LocalDate due) {
    return new ReportIssueDetails.Candidate(id, reason, null, due, null, null, false);
  }

  /** 처음 본 이슈만 싣는다 — 앞 이유가 이긴다. */
  private static void add(
      List<ReportIssueDetails.Candidate> out, Set<Long> seen, ReportIssueDetails.Candidate c) {
    if (seen.add(c.id())) out.add(c);
  }

  /**
   * 묶음 이름이 빈 후보에 에픽 제목과 묶음(에픽, 없으면 프로젝트 이름)을 한 번에 채운다. 그 사이 지워져 못 읽은 이슈는 뺀다(표시 단계에서도 빠질 이슈라 밀린 건수에
   * 섞이지 않게).
   */
  private List<ReportIssueDetails.Candidate> withGroups(List<ReportIssueDetails.Candidate> all) {
    List<Long> unknown = all.stream().filter(c -> c.group() == null).map(c -> c.id()).toList();
    Map<Long, EpicProject> names = issueRepository.epicAndProject(unknown);
    List<ReportIssueDetails.Candidate> out = new ArrayList<>(all.size());
    for (ReportIssueDetails.Candidate c : all) {
      if (c.group() != null) {
        out.add(c);
        continue;
      }
      EpicProject n = names.get(c.id());
      if (n != null) out.add(c.withEpic(n.epic(), n.group()));
    }
    return out;
  }

  /**
   * 일일 「어제 숫자」 표 — 머리까지 시스템이 쓰는 가로 한 줄 {@code | 끝냄 | 새로 만듦 | 상태 바꿈 | 기한 지남 |}. 끝냄 칸은 「4 · 기한 내 3 ·
   * AI와 함께 1」, 0 인 꼬리는 뺀다. 없으면 「한 줄」 섹션 뒤에 「어제 숫자」 섹션으로 넣는다.
   */
  public static ReportTableSpec dailySpec(MetricsSummary cur, int statusChanged, int overdueNow) {
    StringBuilder done = new StringBuilder(num(cur.completed()));
    if (cur.onTime() > 0) done.append(" · 기한 내 ").append(cur.onTime());
    if (cur.completedWithAi() > 0) done.append(" · AI와 함께 ").append(cur.completedWithAi());
    return new ReportTableSpec(
        DAILY_HEAD,
        List.of("끝냄", "새로 만듦", "상태 바꿈", "기한 지남"),
        List.of(List.of(done.toString(), num(cur.created()), num(statusChanged), num(overdueNow))),
        DAILY_SECTION,
        AFTER_SECTION);
  }

  /**
   * 주간·월간 「지난주 대비 / 지난달 대비」 세로 표 — 프로젝트 표와 같은 3칸(항목·이번·변화). 행 순서는 끝냄 / 그중 AI와 함께 / 기한 내 / 기한 초과 /
   * 새로 만듦 / 평균 소요(일, 소수 1자리) / 기한 지남(지금, 지난 값이 없어 변화 「—」). 섹션 제목은 머리 첫 칸 낱말.
   *
   * @param prev 비교 기간 요약 — 주간은 지난주, 월간은 지난 달력 달
   */
  public static ReportTableSpec periodSpec(
      PersonalReportKind kind, MetricsSummary cur, MetricsSummary prev, int overdueNow) {
    boolean monthly = kind == PersonalReportKind.MONTHLY;
    String head = monthly ? "지난달 대비" : "지난주 대비";
    String now = monthly ? "이번 달" : "이번 주";
    List<List<String>> body =
        List.of(
            List.of("끝냄", num(cur.completed()), diff(cur.completed(), prev.completed())),
            List.of(
                "그중 AI와 함께",
                num(cur.completedWithAi()),
                diff(cur.completedWithAi(), prev.completedWithAi())),
            List.of("기한 내", num(cur.onTime()), diff(cur.onTime(), prev.onTime())),
            List.of("기한 초과", num(cur.overdue()), diff(cur.overdue(), prev.overdue())),
            List.of("새로 만듦", num(cur.created()), diff(cur.created(), prev.created())),
            List.of(
                "평균 소요",
                ReportNumbers.days(cur.leadTimeDaysAvg()),
                ReportNumbers.diffDays(cur.leadTimeDaysAvg(), prev.leadTimeDaysAvg())),
            List.of("기한 지남(지금)", num(overdueNow), DASH));
    return new ReportTableSpec(PERIOD_HEAD, List.of(head, now, "변화"), body, head, AFTER_SECTION);
  }
}
