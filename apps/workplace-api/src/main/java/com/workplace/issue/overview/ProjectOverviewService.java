package com.workplace.issue.overview;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.global.dto.UserSummary;
import com.workplace.issue.domain.IssueKeys;
import com.workplace.issue.dto.IssueDueWindow;
import com.workplace.issue.dto.IssueHistoryEventType;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.IssueTypeRow;
import com.workplace.issue.metrics.IssueMetricsCalculator;
import com.workplace.issue.metrics.IssueMetricsService;
import com.workplace.issue.metrics.MetricsCounts;
import com.workplace.issue.metrics.MetricsPeriod;
import com.workplace.issue.overview.ProjectOverviewRepository.AttentionCounts;
import com.workplace.issue.overview.ProjectOverviewRepository.AttentionRow;
import com.workplace.issue.overview.ProjectOverviewRepository.EpicCounts;
import com.workplace.issue.overview.ProjectOverviewRepository.EpicRow;
import com.workplace.issue.overview.ProjectOverviewRepository.HistoryRow;
import com.workplace.issue.overview.ProjectOverviewRepository.OpenStats;
import com.workplace.issue.overview.ProjectOverviewRepository.ScopeRow;
import com.workplace.issue.overview.ProjectOverviewRepository.TargetRow;
import com.workplace.issue.overview.ProjectOverviewRepository.WorkloadRow;
import com.workplace.issue.overview.ProjectOverviewResponse.ActivityGroup;
import com.workplace.issue.overview.ProjectOverviewResponse.Attention;
import com.workplace.issue.overview.ProjectOverviewResponse.AttentionGroup;
import com.workplace.issue.overview.ProjectOverviewResponse.AttentionItem;
import com.workplace.issue.overview.ProjectOverviewResponse.Cards;
import com.workplace.issue.overview.ProjectOverviewResponse.Comparison;
import com.workplace.issue.overview.ProjectOverviewResponse.DueSoon;
import com.workplace.issue.overview.ProjectOverviewResponse.EpicItem;
import com.workplace.issue.overview.ProjectOverviewResponse.Epics;
import com.workplace.issue.overview.ProjectOverviewResponse.IssueRef;
import com.workplace.issue.overview.ProjectOverviewResponse.OpenIssues;
import com.workplace.issue.overview.ProjectOverviewResponse.Others;
import com.workplace.issue.overview.ProjectOverviewResponse.Overdue;
import com.workplace.issue.overview.ProjectOverviewResponse.Person;
import com.workplace.issue.overview.ProjectOverviewResponse.Point;
import com.workplace.issue.overview.ProjectOverviewResponse.Progress;
import com.workplace.issue.overview.ProjectOverviewResponse.StatusSummary;
import com.workplace.issue.overview.ProjectOverviewResponse.Target;
import com.workplace.issue.overview.ProjectOverviewResponse.Workload;
import com.workplace.issue.overview.ProjectOverviewResponse.WorkloadItem;
import com.workplace.issue.overview.status.ProjectStatusRule;
import com.workplace.issue.overview.status.ProjectStatusSummaryRepository;
import com.workplace.issue.overview.status.StatusBadge;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueAttentionConditions;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueRepository.ChildProgress;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectAccessGuard;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 「개요」 탭(WP-1478) — 숫자 카드·진행 중·열린 이슈·살펴볼 이슈·작업량·최근 활동을 한 응답으로 만든다.
 *
 * <p>완료·새로 생김 카드는 지표 모듈({@link IssueMetricsService#countsForProject} — 성과 화면 {@code forProject} 와
 * 같은 정의를 한 문장으로 센다)의 최근 7일·앞 7일 값을 쓴다 — 성과 화면과 같은 「완료 수」가 보이게. 나머지는 {@link
 * ProjectOverviewRepository} 로 이슈 탭 기본 범위(SUBTASK·EPIC 제외) 안에서 센다. 살펴볼 이슈의 정의는 {@link
 * IssueAttentionConditions} 하나를 이슈 검색 {@code stale}·{@code waiting} 필터와 함께 쓴다.
 *
 * <p>쿼리 수는 이슈 수와 무관하게 고정이다(프로젝트·역할 확인 + 지표 1 + 개요 조회 십여 개). 캐시는 두지 않는다 — 1초 목표는 집계 쿼리와 기존 인덱스로 맞춘다.
 *
 * <p>공개 메서드는 {@code @Transactional(readOnly = true)} — 테넌트 GUC 가 걸려야 RLS 가 행을 보여 준다.
 */
@Service
@RequiredArgsConstructor
public class ProjectOverviewService {

  /** 숫자 카드 비교 기간(일) — 최근 7일(오늘 포함)과 그 앞 7일. */
  static final int RECENT_DAYS = 7;

  /** 마감 임박 범위(일) — 오늘 ~ 오늘+6(설계 「7일 안 마감」). */
  static final int DUE_SOON_DAYS = 7;

  /** 살펴볼 이슈 묶음마다 내려 주는 상위 건수 — 타일을 바꿔도 다시 요청하지 않게 세 묶음 모두 싣는다. */
  static final int ATTENTION_TOP = 5;

  /** 작업량 위젯에 이름으로 보이는 사람 수. */
  static final int WORKLOAD_TOP = 5;

  /** EPIC 유형 이름 — 프로젝트별 issue_type_def 의 시스템 유형. */
  static final String EPIC_TYPE = "EPIC";

  /** 에픽 목록 줄 수(설계 「최근 움직임」 4개). */
  static final int EPIC_TOP = 4;

  /** 최근 활동 — 읽는 이력 건수와 내려 주는 묶음 수(웹은 두 열 3줄씩). */
  static final int ACTIVITY_SCAN = 60;

  static final int ACTIVITY_GROUPS = 6;

  /** 예상 완료 속도를 재는 최근 기간(일). */
  static final int VELOCITY_DAYS = 14;

  /** 남은 일에서 진행 중 이슈를 이미 해 둔 몫으로 빼는 비율 — 진행 중은 4분의 1 끝난 것으로 본다(설계 「데이터와 계산」). */
  static final double IN_PROGRESS_CREDIT = 0.25;

  /** 그래프 점 상한 — 기간이 이보다 길면 주 단위(7일 간격)로 줄인다. */
  static final int MAX_POINTS = 120;

  /** 버전 시작일이 없을 때 출시일에서 거슬러 올라가는 일수 — 출시일 포함 4주. */
  static final int VERSION_DEFAULT_SPAN_DAYS = 27;

  /** 전체 추이 주 수. */
  static final int TREND_WEEKS = 8;

  private final ProjectAccessGuard accessGuard;
  private final IssueMetricsService metricsService;
  private final ProjectOverviewRepository repository;
  private final IssueRepository issueRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final IssueTypeRepository typeRepository;
  private final ProjectStatusSummaryRepository statusSummaryRepository;
  private final AssistantResolver assistantResolver;

  /** 「오늘」의 기준 시계 — 서울 날짜로 바꿔 쓴다(JVM 기본 zone 이 UTC). */
  private final Clock clock = Clock.systemUTC();

  /** 개요 한 화면 — 지금 시각 기준. 프로젝트를 읽을 수 없으면 404(ProjectNotFoundException). */
  @Transactional(readOnly = true)
  public ProjectOverviewResponse overview(Long callerId, String projectKey) {
    return overview(callerId, projectKey, OffsetDateTime.now(clock));
  }

  /**
   * 개요 한 화면 — 시각을 받는 판. 테스트가 서울 날짜를 고정하려고 같은 패키지에서 부른다(싱글턴 빈의 시계를 바꾸지 않게).
   *
   * @param now 「지금」 — 서울 날짜로 오늘을 정하고, 오래 멈춤 기준 시각(지금 − 7일)을 정한다
   */
  @Transactional(readOnly = true)
  ProjectOverviewResponse overview(Long callerId, String projectKey, OffsetDateTime now) {
    Objects.requireNonNull(callerId, "callerId");
    // 권한은 프로젝트 한 번·역할 한 번으로 본다 — assertReadable 과 같은 규칙(OPEN 이거나, 역할이 있으면 = 멤버 또는 비PERSONAL 의
    // ADMIN). 못 읽으면 없는 프로젝트와 같은 404(WP-588).
    ProjectRow project = accessGuard.resolve(projectKey);
    String role = accessGuard.viewerRole(project, callerId);
    if (role == null && !"OPEN".equals(project.type())) {
      throw ProjectNotFoundException.hidden();
    }
    // 사이클을 만들 수 있는 사람과 같은 판정 — CycleService.create 의 assertWithRole(OWNER)(ADMIN 우회 포함).
    boolean canManage = "ADMIN".equals(role) || "OWNER".equals(role);
    // 화면 응답만 상태 요약 카드를 싣는다 — 본체는 요약 없이 계산하고, 그 진행 중 위젯·오늘로 배지를 정해 붙인다.
    ProjectOverviewResponse base = compute(project, canManage, now);
    return base.withStatusSummary(statusSummary(project.id(), base.progress(), base.today()));
  }

  /**
   * 권한 검사 없이 프로젝트 개요를 계산한다 — 사람 요청이 아닌 시스템 작업(프로젝트 상태 AI 요약, WP-1479) 전용. 호출자가 프로젝트를 이미 골랐고(삭제되지 않은
   * 행) 테넌트 트랜잭션 안이어야 한다. 화면 응답으로 내보내지 않으므로 canManage 는 false, statusSummary 는 null 로 둔다(요약을 만드는 쪽이
   * 자기 결과를 다시 읽지 않게).
   *
   * @param project 계산할 프로젝트
   * @param now 「지금」 — {@link #overview(Long, String, OffsetDateTime)} 와 같은 뜻
   */
  @Transactional(readOnly = true)
  public ProjectOverviewResponse computeWithoutAccessCheck(ProjectRow project, OffsetDateTime now) {
    return compute(project, false, now);
  }

  /**
   * 맨 위 「프로젝트 상태」 카드 값(WP-1479) — 워크스페이스가 AI 를 쓸 수 있고 저장된 요약 글이 있을 때만. AI 를 끊은 뒤에는 옛 요약이 남아 있어도 숨긴다
   * — 더는 갱신되지 않는 글을 「AI 요약」으로 보이지 않게.
   *
   * <p>배지는 저장값이 아니라 이번 응답의 진행 중 위젯과 오늘로 {@link ProjectStatusRule} 을 불러 다시 정한다. 저장 배지는 AI 글과 함께만
   * 바뀌므로, AI 호출이 실패하거나 다음 점검 전이면 진행 중 위젯(늦은 일수)과 어긋난다 — 화면은 늘 지금 숫자와 같은 배지를 보인다(저장 배지는 해시·이력용으로
   * 남긴다).
   *
   * @param progress 이번 응답의 진행 중 위젯
   * @param today 이번 응답의 오늘(서울)
   */
  private StatusSummary statusSummary(long projectId, Progress progress, LocalDate today) {
    // 요약 행을 먼저 본다 — 대부분 프로젝트는 글이 없으니 그때는 비서 해석(설정 조회)을 건너뛴다.
    var row =
        statusSummaryRepository
            .find(projectId)
            .filter(r -> r.summary() != null && !r.summary().isBlank() && r.badge() != null);
    if (row.isEmpty()) return null;
    if (assistantResolver.resolveWorkspaceOrEmpty().isEmpty()) return null;
    var r = row.get();
    StatusBadge live = ProjectStatusRule.badge(progress, today);
    return new StatusSummary(live.name(), r.summary(), r.checkedAt(), r.nextRunAt());
  }

  /**
   * 개요 계산 본체 — 권한 판단을 마친 뒤 부른다(사람 요청·시스템 작업 공통). 상태 요약 카드는 싣지 않는다(statusSummary null) — 화면 응답만
   * {@link #overview(Long, String, OffsetDateTime)} 가 이 결과의 진행 중 위젯으로 붙인다(요약을 만드는 시스템 작업이 자기 결과를 다시
   * 읽지 않게).
   */
  private ProjectOverviewResponse compute(
      ProjectRow project, boolean canManage, OffsetDateTime now) {
    long pid = project.id();
    LocalDate today = IssueMetricsCalculator.seoulDate(now);

    MetricsCounts metrics =
        metricsService.countsForProject(
            project, new MetricsPeriod(today.minusDays(RECENT_DAYS - 1L), today));
    OpenStats open = repository.openStats(pid, today, today.plusDays(DUE_SOON_DAYS - 1L));
    Attention attention = attention(project, today, now);

    // 기한 지남 카드는 살펴볼 이슈 「기한 지남」 묶음 하나에서 — 수는 그 total, 가장 오래 지난 일수는 마감 오래된 순 첫 줄의 일수.
    AttentionGroup overdue = attention.overdue();
    Cards cards =
        new Cards(
            new Comparison(metrics.completed(), metrics.previousCompleted()),
            new Comparison(metrics.created(), metrics.previousCreated()),
            new DueSoon(open.dueSoon(), open.dueSoonUnassigned()),
            new Overdue(
                overdue.total(), overdue.items().isEmpty() ? null : overdue.items().get(0).days()));

    OpenIssues openIssues =
        new OpenIssues(
            open.todo() + open.inProgress(), open.todo(), open.inProgress(), open.unassigned());

    return new ProjectOverviewResponse(
        today,
        canManage,
        null,
        cards,
        progress(project, today, openIssues.total()),
        openIssues,
        attention,
        workload(pid, open.unassigned()),
        activity(project));
  }

  // ───────────────────────── 진행 중 ─────────────────────────

  /**
   * 진행 중 위젯 — ACTIVE 사이클(종료일 가까운 것) → 미출시 버전(출시일 가까운 것) → 프로젝트 전체 8주 추이 순으로 고른다. 에픽 요약은 어느 경우든 함께
   * 싣는다.
   */
  private Progress progress(ProjectRow project, LocalDate today, int openTotal) {
    long pid = project.id();
    Epics epics = epics(project);
    var cycle = repository.findActiveCycle(pid);
    if (cycle.isPresent()) {
      TargetRow c = cycle.get();
      return scoped("CYCLE", c, c.start(), repository.cycleScope(pid, c.id()), today, epics);
    }
    var version = repository.findUpcomingVersion(pid, today);
    if (version.isPresent()) {
      TargetRow v = version.get();
      LocalDate start = v.start();
      // 시작일이 없거나 출시일보다 늦으면(잘못 넣은 값) 출시일 포함 4주를 기간으로 본다.
      if (start == null || start.isAfter(v.end())) {
        start = v.end().minusDays(VERSION_DEFAULT_SPAN_DAYS);
      }
      return scoped("VERSION", v, start, repository.versionScope(pid, v.id()), today, epics);
    }
    return trend(pid, today, openTotal, epics);
  }

  /** 사이클·버전 범위의 그래프·예상 완료. */
  private static Progress scoped(
      String kind,
      TargetRow t,
      LocalDate start,
      List<ScopeRow> rows,
      LocalDate today,
      Epics epics) {
    int total = rows.size();
    int done = (int) rows.stream().filter(ProjectOverviewService::isDone).count();
    int inProgress =
        (int) rows.stream().filter(r -> IssueStatuses.IN_PROGRESS.equals(r.status())).count();
    List<Point> points = new ArrayList<>();
    for (LocalDate d : pointDates(start, today)) {
      points.add(new Point(d, scopeAt(rows, d), doneAt(rows, d)));
    }
    LocalDate projected = projectedDate(rows, total, done, inProgress, start, today);
    Integer lateDays =
        projected == null || t.end() == null
            ? null
            : (int) ChronoUnit.DAYS.between(t.end(), projected);
    return new Progress(
        kind,
        new Target(t.id(), t.name(), start, t.end()),
        total,
        done,
        points,
        projected,
        lateDays,
        null,
        epics);
  }

  private static boolean isDone(ScopeRow r) {
    return IssueStatuses.DONE.equals(r.status()) && r.closedAt() != null;
  }

  /** 그날 끝 시점의 범위 — 연결 시각(서울 날짜)이 그날 이전인 이슈. 버전은 연결 시각이 없어 지금 범위로 평평하다. */
  static int scopeAt(List<ScopeRow> rows, LocalDate d) {
    return (int) rows.stream().filter(r -> addedBy(r, d)).count();
  }

  /** 그날 끝 시점의 완료 — 범위 안 이슈 중 DONE 이고 닫힌 날(서울)이 그날 이전. */
  static int doneAt(List<ScopeRow> rows, LocalDate d) {
    return (int)
        rows.stream()
            .filter(r -> addedBy(r, d) && isDone(r))
            .filter(r -> !IssueMetricsCalculator.seoulDate(r.closedAt()).isAfter(d))
            .count();
  }

  private static boolean addedBy(ScopeRow r, LocalDate d) {
    return r.addedAt() == null || !IssueMetricsCalculator.seoulDate(r.addedAt()).isAfter(d);
  }

  /**
   * 그래프 점 날짜 — 기간 시작 ~ 오늘(오늘이 시작 전이면 빈 목록). {@link #MAX_POINTS} 를 넘으면 시작부터 7일 간격으로 줄이고 오늘은 마지막에 꼭
   * 넣는다. 사이클이 끝났는데 아직 ACTIVE 면 종료일을 넘어 오늘까지 그린다(실선은 오늘까지라는 설계).
   */
  static List<LocalDate> pointDates(LocalDate start, LocalDate today) {
    List<LocalDate> out = new ArrayList<>();
    if (today.isBefore(start)) return out;
    long days = ChronoUnit.DAYS.between(start, today) + 1;
    int step = days > MAX_POINTS ? 7 : 1;
    for (LocalDate d = start; !d.isAfter(today); d = d.plusDays(step)) {
      out.add(d);
    }
    if (!out.get(out.size() - 1).equals(today)) out.add(today);
    return out;
  }

  /**
   * 예상 완료일 — 남은 = 범위 − 완료 − 0.25×진행 중, 속도 = 최근 14일(기간 시작이 더 늦으면 그때부터, 오늘 포함) 완료 수 ÷ 일수. 예상일 = 오늘 +
   * ceil(남은 ÷ 속도). 범위가 0 이거나 속도가 0 이면(남은 일이 있는데) 예상할 수 없어 null. 남은 일이 없으면 오늘.
   */
  static LocalDate projectedDate(
      List<ScopeRow> rows, int total, int done, int inProgress, LocalDate start, LocalDate today) {
    if (total == 0) return null;
    double remaining = total - done - IN_PROGRESS_CREDIT * inProgress;
    if (remaining <= 0) return today;
    LocalDate windowStart = today.minusDays(VELOCITY_DAYS - 1L);
    if (start.isAfter(windowStart)) windowStart = start;
    if (windowStart.isAfter(today)) return null;
    final LocalDate from = windowStart;
    long recentDone =
        rows.stream()
            .filter(ProjectOverviewService::isDone)
            .map(r -> IssueMetricsCalculator.seoulDate(r.closedAt()))
            .filter(d -> !d.isBefore(from) && !d.isAfter(today))
            .count();
    if (recentDone == 0) return null;
    long windowDays = ChronoUnit.DAYS.between(from, today) + 1;
    // 남은 ÷ (완료 ÷ 일수) 를 남은 × 일수 ÷ 완료 로 계산한다 — 속도를 먼저 나누면 1/11 같은 값의 부동소수 오차로 ceil 이 하루 밀린다.
    return today.plusDays((long) Math.ceil(remaining * windowDays / recentDone));
  }

  /**
   * 프로젝트 전체 8주 추이 — 지난 7주 각 월요일과 오늘, 8개 시점의 열린 작업 이슈 수(그날 끝 기준). 사이클·버전이 없을 때 보인다.
   *
   * @param openTotal 지금 열린 이슈 수(열린 이슈 위젯과 같은 값)
   */
  private Progress trend(long pid, LocalDate today, int openTotal, Epics epics) {
    List<LocalDate> dates = trendDates(today);
    List<OffsetDateTime> instants = dates.stream().map(IssueDueWindow::endOfDayExclusive).toList();
    List<Integer> counts = repository.openCountsAt(pid, instants);
    List<Point> points = new ArrayList<>();
    for (int i = 0; i < dates.size(); i++) {
      points.add(new Point(dates.get(i), counts.get(i), null));
    }
    int delta = counts.get(counts.size() - 1) - counts.get(0);
    return new Progress("TREND", null, openTotal, null, points, null, null, delta, epics);
  }

  /** 추이 시점 — 이번 주 월요일에서 7주 전 ~ 1주 전 월요일, 그리고 오늘(8개). 오늘이 월요일이면 마지막이 이번 주 월요일이다. */
  static List<LocalDate> trendDates(LocalDate today) {
    LocalDate thisMonday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    List<LocalDate> out = new ArrayList<>();
    for (int w = TREND_WEEKS - 1; w >= 1; w--) {
      out.add(thisMonday.minusWeeks(w));
    }
    out.add(today);
    return out;
  }

  /**
   * 에픽 요약 — 닫히지 않은 에픽 수와 최근 움직인 4개(자식 완료/전체, 취소 자식도 끝난 것으로 — 에픽 진행률 규칙 WP-243). 프로젝트에 EPIC 유형이
   * 없으면(PERSONAL 등) 에픽 조회를 하지 않고 빈 요약을 낸다.
   */
  private Epics epics(ProjectRow project) {
    Long epicTypeId =
        typeRepository
            .findByProjectAndName(project.id(), EPIC_TYPE)
            .map(IssueTypeRow::id)
            .orElse(null);
    if (epicTypeId == null) return new Epics(null, 0, 0, List.of());
    EpicCounts counts = repository.epicCounts(project.id(), epicTypeId);
    List<EpicRow> rows = repository.recentEpics(project.id(), epicTypeId, EPIC_TOP);
    Map<Long, ChildProgress> children =
        issueRepository.countChildProgressByParentIds(rows.stream().map(EpicRow::issueId).toList());
    List<EpicItem> items =
        rows.stream()
            .map(
                r -> {
                  ChildProgress c = children.getOrDefault(r.issueId(), new ChildProgress(0, 0));
                  return new EpicItem(
                      IssueKeys.format(project.key(), r.number()),
                      r.number(),
                      r.title(),
                      c.done(),
                      c.total());
                })
            .toList();
    return new Epics(epicTypeId, counts.inProgress(), counts.total(), items);
  }

  // ───────────────────────── 살펴볼 이슈 ─────────────────────────

  /**
   * 살펴볼 이슈 세 묶음 — 묶음별 total·상위 5건, 그리고 세 묶음에 든 서로 다른 이슈 수. 숫자 넷은 한 문장(COUNT FILTER)으로 세고, 상위 목록의
   * 담당자는 15건 id 를 모아 한 번에 읽는다. 숫자 카드 「기한 지남」도 이 묶음에서 가져간다(한 정의).
   */
  private Attention attention(ProjectRow project, LocalDate today, OffsetDateTime now) {
    long pid = project.id();
    OffsetDateTime cutoff = IssueAttentionConditions.staleCutoff(now);
    Condition overdue = IssueAttentionConditions.overdue(today);
    Condition stale = IssueAttentionConditions.stale(cutoff);
    Condition waiting = IssueAttentionConditions.waiting();

    AttentionCounts counts = repository.attentionCounts(pid, overdue, stale, waiting);

    List<AttentionRow> overdueTop = repository.topOverdue(pid, today, ATTENTION_TOP);
    List<AttentionRow> staleTop =
        repository.topBySince(pid, stale, IssueAttentionConditions.lastMovedAt(), ATTENTION_TOP);
    List<AttentionRow> waitingTop =
        repository.topBySince(pid, waiting, IssueAttentionConditions.waitingSince(), ATTENTION_TOP);

    Set<Long> ids = new LinkedHashSet<>();
    for (List<AttentionRow> list : List.of(overdueTop, staleTop, waitingTop)) {
      list.forEach(r -> ids.add(r.issueId()));
    }
    Map<Long, List<UserSummary>> assignees = assigneeRepository.findByIssueIds(List.copyOf(ids));

    return new Attention(
        counts.union(),
        new AttentionGroup(counts.overdue(), items(project, overdueTop, assignees, today)),
        new AttentionGroup(counts.stale(), items(project, staleTop, assignees, today)),
        new AttentionGroup(counts.waiting(), items(project, waitingTop, assignees, today)));
  }

  /** 살펴볼 이슈 줄 — 일수는 기한 지남이면 마감일부터, 아니면 기준 시각(서울 날짜)부터 오늘까지(음수는 0). */
  private static List<AttentionItem> items(
      ProjectRow project,
      List<AttentionRow> rows,
      Map<Long, List<UserSummary>> assignees,
      LocalDate today) {
    return rows.stream()
        .map(
            r -> {
              LocalDate from =
                  r.dueDate() != null ? r.dueDate() : IssueMetricsCalculator.seoulDate(r.since());
              int days = (int) Math.max(0, ChronoUnit.DAYS.between(from, today));
              return new AttentionItem(
                  IssueKeys.format(project.key(), r.number()),
                  r.number(),
                  r.title(),
                  days,
                  assignees.getOrDefault(r.issueId(), List.of()).stream()
                      .map(ProjectOverviewService::person)
                      .toList());
            })
        .toList();
  }

  // ───────────────────────── 작업량 ─────────────────────────

  /** 작업량 — 많은 순 5명 + 담당자 없음 + 「그 외 n명 · n건」(담당 여럿이면 각자 셈). */
  private Workload workload(long pid, int unassigned) {
    List<WorkloadRow> rows = repository.workload(pid);
    List<WorkloadItem> top =
        rows.stream()
            .limit(WORKLOAD_TOP)
            .map(
                r -> {
                  Person p = r.person();
                  return new WorkloadItem(p.id(), p.name(), p.kind(), p.active(), r.count());
                })
            .toList();
    List<WorkloadRow> rest = rows.stream().skip(WORKLOAD_TOP).toList();
    int restIssues = rest.stream().mapToInt(WorkloadRow::count).sum();
    return new Workload(top, unassigned, new Others(rest.size(), restIssues));
  }

  // ───────────────────────── 최근 활동 ─────────────────────────

  /**
   * 최근 활동 — 최근 60건 이력을 시각 내림차순으로 읽어 같은 사람·같은 종류가 이어지면 한 묶음으로 합치고 앞의 6묶음을 준다. 묶음의 수는 이력 행 수가 아니라 서로
   * 다른 이슈 수다(한 사람이 WP-12 상태를 세 번 바꿔도 1건). 묶음에 든 이슈가 하나면 그 이슈 키·제목을 붙인다. 시각은 서울 오프셋으로 낸다.
   */
  private List<ActivityGroup> activity(ProjectRow project) {
    return groupActivity(project.key(), repository.recentHistory(project.id(), ACTIVITY_SCAN));
  }

  /**
   * 묶기에 쓰는 이력 종류 — 담당자 변경은 옛 단일 담당 이벤트(ASSIGNEE_CHANGED)와 지금의 여럿 담당 이벤트(ASSIGNEES_CHANGED)가 같은 일이라
   * 하나로 본다. 응답에도 이 값을 내보내 웹이 한 문구로 그리게 한다.
   */
  static String activityKind(String eventType) {
    return IssueHistoryEventType.ASSIGNEE_CHANGED.name().equals(eventType)
        ? IssueHistoryEventType.ASSIGNEES_CHANGED.name()
        : eventType;
  }

  /** 이력 묶기 — {@link #activity} 참조. 같은 패키지 테스트가 순수하게 확인할 수 있게 정적으로 둔다. */
  static List<ActivityGroup> groupActivity(String projectKey, List<HistoryRow> rows) {
    List<ActivityGroup> out = new ArrayList<>();
    HistoryRow first = null;
    String kind = null;
    // 묶음에 든 서로 다른 이슈 번호 — 프로젝트 안에서 번호가 이슈를 하나로 정한다.
    Set<Integer> issues = new LinkedHashSet<>();
    for (HistoryRow r : rows) {
      String rKind = activityKind(r.eventType());
      if (first != null && first.actor().id() == r.actor().id() && kind.equals(rKind)) {
        issues.add(r.number());
        continue;
      }
      if (first != null) {
        out.add(toGroup(projectKey, first, kind, issues.size()));
        if (out.size() == ACTIVITY_GROUPS) return out;
      }
      first = r;
      kind = rKind;
      issues.clear();
      issues.add(r.number());
    }
    if (first != null) out.add(toGroup(projectKey, first, kind, issues.size()));
    return out;
  }

  /** 묶음 → 응답. 시각·이슈는 묶음의 첫(가장 최근) 이력에서 — 이슈가 하나뿐이면 그 이력의 이슈가 곧 묶음의 이슈다. */
  private static ActivityGroup toGroup(
      String projectKey, HistoryRow first, String kind, int issueCount) {
    return new ActivityGroup(
        first.actor(),
        kind,
        issueCount,
        first.createdAt().atZoneSameInstant(IssueDueWindow.ZONE).toOffsetDateTime(),
        issueCount == 1
            ? new IssueRef(
                IssueKeys.format(projectKey, first.number()), first.number(), first.title())
            : null);
  }

  /** 담당자 요약 → 응답 사람(활성 여부 포함 — 담당자 조회가 채운다). */
  private static Person person(UserSummary u) {
    return new Person(u.id(), u.name(), u.kind(), Boolean.TRUE.equals(u.active()));
  }
}
