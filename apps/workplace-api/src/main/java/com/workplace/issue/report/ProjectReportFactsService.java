package com.workplace.issue.report;

import com.workplace.issue.metrics.IssueMetricsService;
import com.workplace.issue.metrics.MetricsCounts;
import com.workplace.issue.overview.ProjectOverviewResponse;
import com.workplace.issue.overview.ProjectOverviewResponse.Progress;
import com.workplace.issue.overview.ProjectOverviewService;
import com.workplace.issue.overview.status.ProjectStatusRule;
import com.workplace.issue.overview.status.StatusBadge;
import com.workplace.project.dto.ProjectRow;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 리포트 계산값(WP-1483) — 표의 숫자·배지·기간 이슈 목록을 시스템이 정한다. 숫자는 새로 세지 않고 기존 정의를 그대로 쓴다: 완료·새로 생김은 지표 모듈
 * ({@link IssueMetricsService#countsForProject}), 열린 이슈·기한 지남·진행 중은 개요({@link
 * ProjectOverviewService#computeWithoutAccessCheck}), 배지는 {@link ProjectStatusRule} — 개요 화면·상태 요약과
 * 같은 숫자가 나오게.
 */
@Service
@RequiredArgsConstructor
public class ProjectReportFactsService {

  /** 기간 이슈 목록 상한 — 생성 비용 상한(넘치면 에픽별 남은 건수로 요약). */
  public static final int ISSUE_LIMIT = 60;

  /** 비교할 값이 없을 때 변화 칸. */
  static final String DASH = "—";

  /** 음수 부호 — 하이픈이 아니라 U+2212(표 숫자 정렬·가독성, 시안과 같은 글자). */
  static final String MINUS = "−";

  private final IssueMetricsService metricsService;
  private final ProjectOverviewService overviewService;
  private final ProjectReportIssueRepository issueRepository;

  /**
   * 한 회차의 계산값을 만든다. <b>권한 검사 없음 — 시스템(리포트 실행기) 전용</b>이다. 호출자가 삭제되지 않은 프로젝트 행을 골랐고 테넌트 컨텍스트가 있어야 한다.
   *
   * @param project 계산할 프로젝트
   * @param period 회차
   * @param last 지난 리포트(GENERATED/SKIPPED 중 최신) 스냅숏 — 열린 이슈·기한 지남 변화와 지난 배지에 쓴다. 없으면 변화 「—」, 지난 배지
   *     null
   * @param now 「지금」 — 열린 이슈·기한 지남·진행 중은 이 시각 기준
   */
  @Transactional(readOnly = true)
  public ProjectReportFacts compute(
      ProjectRow project, ReportPeriod period, Optional<ReportSnapshot> last, OffsetDateTime now) {
    MetricsCounts counts = metricsService.countsForProject(project, period.toMetrics());
    // 주간·격주는 같은 길이 앞 기간이 곧 앞 회차라 한 번에 센 값을 쓰고, 월간은 길이가 다른 지난 달력 달을 따로 센다.
    int prevCompleted = counts.previousCompleted();
    int prevCreated = counts.previousCreated();
    if (period.cadence() == ReportCadence.MONTHLY) {
      MetricsCounts prev = metricsService.countsForProject(project, period.previous().toMetrics());
      prevCompleted = prev.completed();
      prevCreated = prev.created();
    }

    ProjectOverviewResponse overview = overviewService.computeWithoutAccessCheck(project, now);
    int open = overview.openIssues().total();
    int overdue = overview.cards().overdue().count();
    StatusBadge badge = ProjectStatusRule.badge(overview.progress(), overview.today());

    List<ReportTableRow> rows = new ArrayList<>();
    rows.add(
        new ReportTableRow("완료", num(counts.completed()), diff(counts.completed(), prevCompleted)));
    rows.add(
        new ReportTableRow("새로 생김", num(counts.created()), diff(counts.created(), prevCreated)));
    rows.add(
        new ReportTableRow(
            "열린 이슈", num(open), last.map(s -> diff(open, s.openIssues())).orElse(DASH)));
    rows.add(
        new ReportTableRow(
            "기한 지남", num(overdue), last.map(s -> diff(overdue, s.overdue())).orElse(DASH)));
    progressRow(overview.progress()).ifPresent(rows::add);

    ProjectReportIssueRepository.Selection sel =
        issueRepository.select(project.id(), period, overview.today(), ISSUE_LIMIT);

    return new ProjectReportFacts(
        period,
        badge,
        last.map(ReportSnapshot::badge).flatMap(ProjectReportFactsService::parseBadge).orElse(null),
        List.copyOf(rows),
        new ReportSnapshot(counts.completed(), counts.created(), open, overdue, badge.name()),
        sel.issues(),
        sel.omittedByEpic(),
        counts.completed() == 0 && counts.created() == 0);
  }

  /**
   * 진행 중 위젯이 사이클·버전일 때만 붙는 행 — 라벨 「사이클 11/10~23」(달이 다르면 「사이클 10/27~11/9」)·「v0.9.57 (11/14)」, 이번
   * 「done / total」, 변화 「예상 M/d」(예상 없으면 「—」).
   */
  static Optional<ReportTableRow> progressRow(Progress p) {
    boolean cycle = "CYCLE".equals(p.kind());
    if (!cycle && !"VERSION".equals(p.kind()) || p.target() == null) return Optional.empty();
    var t = p.target();
    String label;
    if (cycle) {
      label = "사이클 " + (t.start() == null ? "" : md(t.start())) + "~" + endPart(t.start(), t.end());
    } else {
      label = t.end() == null ? t.name() : t.name() + " (" + md(t.end()) + ")";
    }
    int done = p.done() == null ? 0 : p.done();
    String change = p.projectedDate() == null ? DASH : "예상 " + md(p.projectedDate());
    return Optional.of(new ReportTableRow(label, done + " / " + p.total(), change));
  }

  /** 사이클 끝날 표기 — 시작과 같은 달이면 일만, 다르면 「M/d」, 없으면 빈 글자. */
  private static String endPart(LocalDate start, LocalDate end) {
    if (end == null) return "";
    if (start != null && start.getYear() == end.getYear() && start.getMonth() == end.getMonth()) {
      return String.valueOf(end.getDayOfMonth());
    }
    return md(end);
  }

  private static String md(LocalDate d) {
    return d.getMonthValue() + "/" + d.getDayOfMonth();
  }

  private static String num(int n) {
    return String.valueOf(n);
  }

  /** 변화 칸 — {@code +n} / {@code −n}(U+2212) / {@code 0}. */
  static String diff(int current, int previous) {
    int d = current - previous;
    if (d > 0) return "+" + d;
    if (d < 0) return MINUS + (-d);
    return "0";
  }

  /** 저장된 배지 이름을 읽는다 — 모르는 값·null 이면 없음(지난 배지 화살표를 그리지 않는다). */
  private static Optional<StatusBadge> parseBadge(String name) {
    if (name == null) return Optional.empty();
    try {
      return Optional.of(StatusBadge.valueOf(name));
    } catch (IllegalArgumentException e) {
      return Optional.empty();
    }
  }
}
