package com.workplace.issue.report;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_LABEL;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.LABEL;
import static com.workplace.jooq.Tables.PROJECT_STATUS;
import static com.workplace.jooq.Tables.PROJECT_VERSION;
import static com.workplace.jooq.Tables.USER;

import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.metrics.IssueMetricsCalculator;
import com.workplace.issue.overview.ProjectOverviewRepository.ScopeRow;
import com.workplace.issue.overview.ProjectOverviewService;
import com.workplace.issue.report.ProjectReportEpics.CompletedEpic;
import com.workplace.issue.report.ProjectReportEpics.DecisionCandidate;
import com.workplace.issue.report.ProjectReportEpics.InProgressEpic;
import com.workplace.issue.report.ProjectReportEpics.OngoingEpic;
import com.workplace.issue.report.ProjectReportEpics.PastEpic;
import com.workplace.issue.report.ProjectReportEpics.RemainingChild;
import com.workplace.issue.report.ProjectReportEpics.ReportMetric;
import com.workplace.issue.report.ProjectReportEpics.UpcomingEpic;
import com.workplace.project.dto.ProjectRow;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 프로젝트 리포트 에픽 집계(WP-1629) — 에픽 목록·에픽 하위·라벨·담당·댓글·릴리스를 읽어 {@link ProjectReportEpics} 를 만든다.
 *
 * <p>쿼리 수는 에픽·이슈 수와 무관하게 고정이다(에픽 1 + 라벨 1 + 하위 1 + 담당 1 + 댓글 1 + 릴리스 1 + 소유자 1). 이슈의 에픽은 가장 가까운
 * EPIC 조상(부모 → 조부모 → 증조부모, 최대 3단계)이라 「에픽 → 스토리 → 하위 작업」의 하위 작업도 에픽 하위로 센다. RLS 보호 테이블이라 트랜잭션 안에서
 * 부른다.
 */
@Repository
public class ProjectReportEpicRepository {

  /** EPIC 유형 이름 — 프로젝트별 issue_type_def 의 시스템 유형. */
  static final String EPIC_TYPE = "EPIC";

  /** 에픽 본문 요약 길이. */
  static final int SUMMARY_MAX = 700;

  /** 남은 하위 마지막 댓글 길이. */
  static final int COMMENT_MAX = 200;

  private final DSLContext dsl;

  /** 이슈 주소·마지막 코멘트 읽기(개인 보고와 공유). */
  private final ReportIssueDetails details;

  /** 프로젝트 소유자 이름 읽기. */
  private final UserRepository userRepository;

  public ProjectReportEpicRepository(
      DSLContext dsl, ReportIssueDetails details, UserRepository userRepository) {
    this.dsl = dsl;
    this.details = details;
    this.userRepository = userRepository;
  }

  /**
   * 지표 표에 쓸, 다른 모듈이 이미 센 숫자 — 완료 이슈는 지표 모듈, 기한 초과는 개요와 같은 값을 써서 다른 화면과 어긋나지 않게 한다.
   *
   * @param completed 이번 기간 완료 이슈 수
   * @param previousCompleted 지난 기간 완료 이슈 수
   * @param overdue 지금 기한 초과 미완료 이슈 수
   * @param previousOverdue 지난 리포트 스냅숏의 기한 초과 수, 없으면 null
   */
  public record IssueCounts(
      int completed, int previousCompleted, int overdue, Integer previousOverdue) {}

  /** 에픽 한 건(읽은 그대로). */
  private record Epic(
      long id,
      int number,
      String title,
      String body,
      String status,
      LocalDate due,
      OffsetDateTime createdAt,
      OffsetDateTime closedAt,
      boolean ongoing) {

    boolean open() {
      return !IssueStatuses.isClosed(status);
    }
  }

  /** 에픽 하위 또는 에픽 없는 완료 이슈 한 건 — epicId 는 가장 가까운 EPIC 조상, 없으면 null. */
  private record Child(
      long id,
      int number,
      String title,
      String status,
      String statusName,
      LocalDate due,
      OffsetDateTime createdAt,
      OffsetDateTime closedAt,
      Long epicId) {

    boolean done() {
      return IssueStatuses.DONE.equals(status);
    }

    boolean open() {
      return !IssueStatuses.isClosed(status);
    }
  }

  /** 담당자 한 명. */
  private record Assignee(String name, boolean agent) {}

  /**
   * 한 회차의 에픽 집계를 만든다.
   *
   * @param project 프로젝트(소유자 이름·키에 쓴다)
   * @param period 회차 — 지난 기간은 {@link ReportPeriod#previous()}
   * @param today 「오늘」(서울) — 앞으로의 기한·기한 초과·예상 완료일 기준
   * @param counts 지표 표에 쓸, 이미 센 숫자
   */
  public ProjectReportEpics load(
      ProjectRow project, ReportPeriod period, LocalDate today, IssueCounts counts) {
    long pid = project.id();
    OffsetDateTime from = period.toMetrics().startInclusive();
    OffsetDateTime to = period.toMetrics().endExclusive();
    ReportPeriod prev = period.previous();
    OffsetDateTime prevFrom = prev.toMetrics().startInclusive();
    OffsetDateTime prevTo = prev.toMetrics().endExclusive();

    String owner = ownerOrFallback(project);

    // ① 라벨 — 상시·AI 탐색 라벨이 붙은 이슈 id(프로젝트 라벨만).
    Set<Long> ongoingLabeled = new HashSet<>();
    Set<Long> aiTesterLabeled = new HashSet<>();
    dsl.select(ISSUE_LABEL.ISSUE_ID, LABEL.NAME)
        .from(ISSUE_LABEL)
        .join(LABEL)
        .on(LABEL.ID.eq(ISSUE_LABEL.LABEL_ID))
        .join(ISSUE)
        .on(ISSUE.ID.eq(ISSUE_LABEL.ISSUE_ID))
        .where(LABEL.PROJECT_ID.eq(pid))
        // 「AI 탐색」 은 이번 기간 DONE 으로 닫힌 이슈만 쓰므로 그 밖은 읽지 않는다. 「상시」 는 에픽 판정에 쓰여 제한하지 않는다.
        .and(
            LABEL
                .NAME
                .eq(ProjectReportEpics.ONGOING_LABEL)
                .or(
                    LABEL
                        .NAME
                        .eq(ProjectReportEpics.AI_TESTER_LABEL)
                        .and(closedDoneCondition(from, to))))
        .fetch()
        .forEach(
            r -> {
              if (ProjectReportEpics.ONGOING_LABEL.equals(r.value2())) {
                ongoingLabeled.add(r.value1());
              } else {
                aiTesterLabeled.add(r.value1());
              }
            });

    // ② 에픽 목록(삭제 제외, 번호 순).
    List<Epic> epics = epics(pid, ongoingLabeled);

    // 이번 기간 완료한 에픽(상시 제외)과 열린 에픽(상시 제외)은 하위 전체가 필요하다. 상시 에픽·에픽 없는 이슈는 기간 안 완료만 있으면 된다.
    Set<Long> fullChildren = new HashSet<>();
    for (Epic e : epics) {
      if (e.ongoing()) continue;
      if (e.open() || closedDoneIn(e.status(), e.closedAt(), from, to)) fullChildren.add(e.id());
    }

    // ③ 하위(가장 가까운 에픽 조상과 함께).
    List<Child> children = children(pid, fullChildren, from, to);
    Map<Long, List<Child>> byEpic = new HashMap<>();
    List<Child> noEpic = new ArrayList<>();
    // 보고하는 에픽 = 상시 에픽 + 하위 전체를 읽은 에픽(이번 기간 완료·열린 에픽). 그 밖 에픽(이미 닫혔거나 취소된) 아래의 이번 기간 완료 이슈는
    // 어느 목록도 읽지 않으므로 「에픽 밖 완료」로 센다(WP-1629).
    Set<Long> reportedEpics = new HashSet<>(fullChildren);
    for (Epic e : epics) {
      if (e.ongoing()) reportedEpics.add(e.id());
    }
    for (Child c : children) {
      if (c.epicId() == null || !reportedEpics.contains(c.epicId())) {
        noEpic.add(c);
      } else {
        byEpic.computeIfAbsent(c.epicId(), k -> new ArrayList<>()).add(c);
      }
    }

    // ── 완료한 에픽(이번·지난) ──
    List<CompletedEpic> completed = new ArrayList<>();
    List<PastEpic> previousCompleted = new ArrayList<>();
    List<Epic> byClosed =
        epics.stream()
            .filter(
                e ->
                    !e.ongoing()
                        && (closedDoneIn(e.status(), e.closedAt(), from, to)
                            || closedDoneIn(e.status(), e.closedAt(), prevFrom, prevTo)))
            .sorted(Comparator.comparing(Epic::closedAt).thenComparingInt(Epic::number))
            .toList();
    for (Epic e : byClosed) {
      LocalDate closedDate = IssueMetricsCalculator.seoulDate(e.closedAt());
      Integer late = ProjectReportEpics.lateDays(e.due(), closedDate);
      if (closedDoneIn(e.status(), e.closedAt(), from, to)) {
        List<Child> kids = byEpic.getOrDefault(e.id(), List.of());
        completed.add(
            new CompletedEpic(
                key(project, e.number()),
                details.issueUrl(project.key(), e.number()),
                title(e.title()),
                ProjectReportEpics.md(e.due()),
                ProjectReportEpics.md(closedDate),
                late,
                kids.size(),
                summary(e.body()),
                doneTitles(kids.stream().filter(Child::done).toList())));
      } else if (closedDoneIn(e.status(), e.closedAt(), prevFrom, prevTo)) {
        previousCompleted.add(
            new PastEpic(
                key(project, e.number()),
                title(e.title()),
                ProjectReportEpics.md(e.due()),
                ProjectReportEpics.md(closedDate),
                late));
      }
    }

    // ── 진행 중인 에픽: 열려 있고, 이번 기간에 하위가 완료됐거나 생겼거나 기한이 있는 것 ──
    record Working(
        Epic epic,
        List<Child> kids,
        List<Child> remaining,
        List<Child> shown,
        int done,
        LocalDate projected) {}
    List<Working> working = new ArrayList<>();
    for (Epic e : epics) {
      if (e.ongoing() || !e.open()) continue;
      List<Child> kids = byEpic.getOrDefault(e.id(), List.of());
      boolean moved =
          kids.stream()
              .anyMatch(
                  c ->
                      closedDoneIn(c.status(), c.closedAt(), from, to)
                          || in(c.createdAt(), from, to));
      if (!moved && e.due() == null) continue;
      int total = kids.size();
      int done = (int) kids.stream().filter(c -> !c.open()).count();
      int inProgressKids =
          (int) kids.stream().filter(c -> IssueStatuses.IN_PROGRESS.equals(c.status())).count();
      // 개요 「진행 중」 예상 완료와 같은 계산 — 범위는 에픽 하위, 시작일은 에픽이 생긴 날.
      List<ScopeRow> rows =
          kids.stream().map(c -> new ScopeRow(null, c.status(), c.closedAt())).toList();
      // 하위가 있고 모두 닫혔으면 남은 일이 없다 — 예상 완료일을 두지 않아 기한이 지났어도 순조로움(결정 7, WP-1629).
      LocalDate projected =
          total > 0 && done == total
              ? null
              : ProjectOverviewService.projectedDate(
                  rows,
                  total,
                  done,
                  inProgressKids,
                  IssueMetricsCalculator.seoulDate(e.createdAt()),
                  today);
      List<Child> remaining =
          kids.stream().filter(Child::open).sorted(Comparator.comparingInt(Child::number)).toList();
      // 담는 상한(TITLE_LIMIT)까지만 보인다 — 댓글은 보이는 하위에만 읽는다(WP-1629).
      List<Child> shown =
          remaining.subList(0, Math.min(ProjectReportEpics.TITLE_LIMIT, remaining.size()));
      working.add(new Working(e, kids, remaining, shown, done, projected));
    }

    // ④ 담당·⑤ 댓글 — 남은 하위만.
    List<Long> remainingIds =
        working.stream().flatMap(w -> w.remaining().stream()).map(Child::id).toList();
    Map<Long, List<Assignee>> assignees = assignees(remainingIds);
    List<Long> commentIds =
        working.stream()
            .flatMap(w -> w.shown().stream())
            .filter(c -> waitingOnHuman(c, assignees) || overdue(c, today))
            .map(Child::id)
            .toList();
    Map<Long, String> comments = commentIds.isEmpty() ? Map.of() : details.lastComments(commentIds);

    List<InProgressEpic> inProgress = new ArrayList<>();
    List<DecisionCandidate> overdueProjected = new ArrayList<>();
    List<DecisionCandidate> blocked = new ArrayList<>();
    for (Working w : working) {
      Epic e = w.epic();
      String key = key(project, e.number());
      List<Child> doneNow =
          w.kids().stream().filter(c -> closedDoneIn(c.status(), c.closedAt(), from, to)).toList();
      List<RemainingChild> remaining = new ArrayList<>();
      for (Child c : w.shown()) {
        List<Assignee> as = assignees.getOrDefault(c.id(), List.of());
        String comment = comments.get(c.id());
        remaining.add(
            new RemainingChild(
                key(project, c.number()),
                title(c.title()),
                c.statusName(),
                ProjectReportEpics.assigneeLabel(
                    as.stream().filter(a -> !a.agent()).map(Assignee::name).toList(),
                    as.stream().anyMatch(Assignee::agent)),
                comment == null
                    ? null
                    : ReportIssueDetails.cut(ReportIssueDetails.oneLine(comment), COMMENT_MAX)));
      }
      inProgress.add(
          new InProgressEpic(
              key,
              details.issueUrl(project.key(), e.number()),
              title(e.title()),
              w.done(),
              w.kids().size(),
              doneNow.size(),
              ProjectReportEpics.epicStatus(
                  // 하위가 없으면 에픽 자신이 남은 일이다(WP-1629).
                  e.due(), w.projected(), !w.remaining().isEmpty() || w.kids().isEmpty(), today),
              ProjectReportEpics.md(e.due()),
              ProjectReportEpics.md(w.projected()),
              summary(e.body()),
              doneTitles(doneNow),
              // 남은 하위도 제목 목록과 같은 안전 상한으로 자른다(판단 근거는 앞쪽 몇 건이면 충분하다).
              List.copyOf(remaining)));

      Integer late = ProjectReportEpics.lateDays(e.due(), w.projected());
      if (late != null && late > 0) {
        overdueProjected.add(
            new DecisionCandidate(
                ProjectReportEpics.EPIC_OVERDUE_PROJECTED,
                key,
                "예상 완료 "
                    + ProjectReportEpics.md(w.projected())
                    + "로 기한("
                    + ProjectReportEpics.md(e.due())
                    + ")을 "
                    + late
                    + "일 넘김",
                owner));
      }
      if (!w.remaining().isEmpty()
          && w.remaining().stream().allMatch(c -> waitingOnHuman(c, assignees))) {
        // 남은 하위를 맡은 사람 이름(나온 순, 겹침 없이) — 결정할 사람이자 문장 속 이름.
        Set<String> names = new LinkedHashSet<>();
        for (Child c : w.remaining()) {
          assignees.get(c.id()).forEach(a -> names.add(a.name()));
        }
        String joined = String.join(", ", names);
        blocked.add(
            new DecisionCandidate(
                ProjectReportEpics.BLOCKED_ON_HUMAN,
                key,
                "남은 " + w.remaining().size() + "건이 모두 사람(" + joined + ") 담당·할 일 상태",
                joined));
      }
    }

    // ── 앞으로 기한을 정한 에픽 ──
    List<UpcomingEpic> upcoming =
        epics.stream()
            .filter(e -> !e.ongoing() && e.open() && e.due() != null && !e.due().isBefore(today))
            .sorted(Comparator.comparing(Epic::due).thenComparingInt(Epic::number))
            .map(
                e ->
                    new UpcomingEpic(
                        key(project, e.number()), title(e.title()), ProjectReportEpics.md(e.due())))
            .toList();

    // ── 상시 에픽 처리량 — 열려 있거나 이번 기간에 하위를 끝낸 것 ──
    List<OngoingEpic> ongoing = new ArrayList<>();
    for (Epic e : epics) {
      if (!e.ongoing()) continue;
      List<Child> doneNow =
          byEpic.getOrDefault(e.id(), List.of()).stream()
              .filter(c -> closedDoneIn(c.status(), c.closedAt(), from, to))
              .sorted(latestFirst())
              .toList();
      if (doneNow.isEmpty() && !e.open()) continue;
      int found = (int) doneNow.stream().filter(c -> aiTesterLabeled.contains(c.id())).count();
      List<String> titles =
          doneNow.stream()
              .map(
                  c ->
                      aiTesterLabeled.contains(c.id())
                          ? title(c.title()) + " [" + ProjectReportEpics.AI_TESTER_LABEL + "]"
                          : title(c.title()))
              .toList();
      ongoing.add(
          new OngoingEpic(
              title(e.title()), doneNow.size(), found, ProjectReportEpics.capTitles(titles)));
    }

    // ── 결정 후보: NO_NEXT_EPIC → EPIC_OVERDUE_PROJECTED → BLOCKED_ON_HUMAN(각 에픽 번호 순) ──
    List<DecisionCandidate> decisions = new ArrayList<>();
    if (upcoming.isEmpty()) {
      String detail =
          inProgress.isEmpty()
              ? "앞으로 기한을 정한 에픽이 없음"
              : "진행 중 에픽 " + inProgress.size() + "개 외에 앞으로 기한을 정한 에픽이 없음";
      decisions.add(new DecisionCandidate(ProjectReportEpics.NO_NEXT_EPIC, null, detail, owner));
    }
    decisions.addAll(overdueProjected);
    decisions.addAll(blocked);

    // ⑥ 릴리스 수(이번·지난).
    int[] releases = releases(pid, from, to, prevFrom, prevTo);

    List<ReportMetric> metrics =
        List.of(
            new ReportMetric(
                "완료한 에픽",
                ReportNumbers.num(completed.size()),
                ReportNumbers.num(previousCompleted.size())),
            new ReportMetric(
                "기한 내 완료",
                onTime(completed.stream().map(CompletedEpic::lateDays).toList()),
                onTime(previousCompleted.stream().map(PastEpic::lateDays).toList())),
            new ReportMetric(
                "완료한 이슈",
                ReportNumbers.num(counts.completed()),
                ReportNumbers.num(counts.previousCompleted())),
            new ReportMetric("릴리스", releases[0] + "회", releases[1] + "회"),
            new ReportMetric(
                "기한 초과 미완료 이슈",
                ReportNumbers.num(counts.overdue()),
                counts.previousOverdue() == null
                    ? ReportNumbers.DASH
                    : ReportNumbers.num(counts.previousOverdue())));

    // ── 에픽 없이 완료한 이슈 ──
    List<Child> noEpicSorted = noEpic.stream().sorted(latestFirst()).toList();

    return new ProjectReportEpics(
        List.copyOf(completed),
        List.copyOf(previousCompleted),
        List.copyOf(inProgress),
        upcoming,
        List.copyOf(ongoing),
        noEpicSorted.size(),
        doneTitles(noEpicSorted),
        List.copyOf(decisions),
        metrics,
        owner);
  }

  // ───────────────────────── 쿼리 ─────────────────────────

  /** 프로젝트의 에픽(EPIC 유형, 삭제 제외, 번호 순) — 상시 여부는 라벨 id 집합으로 정한다. */
  private List<Epic> epics(long pid, Set<Long> ongoingLabeled) {
    return dsl.select(
            ISSUE.ID,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            ISSUE.BODY,
            ISSUE.STATUS,
            ISSUE.DUE_DATE,
            ISSUE.CREATED_AT,
            ISSUE.CLOSED_AT)
        .from(ISSUE)
        .join(ISSUE_TYPE_DEF)
        .on(ISSUE_TYPE_DEF.ID.eq(ISSUE.TYPE_ID).and(ISSUE_TYPE_DEF.NAME.eq(EPIC_TYPE)))
        .where(ISSUE.PROJECT_ID.eq(pid))
        .and(ISSUE.DELETED_AT.isNull())
        .orderBy(ISSUE.NUMBER.asc())
        .fetch(
            r ->
                new Epic(
                    r.get(ISSUE.ID),
                    r.get(ISSUE.NUMBER),
                    r.get(ISSUE.TITLE),
                    r.get(ISSUE.BODY),
                    r.get(ISSUE.STATUS),
                    r.get(ISSUE.DUE_DATE),
                    r.get(ISSUE.CREATED_AT),
                    r.get(ISSUE.CLOSED_AT),
                    ongoingLabeled.contains(r.get(ISSUE.ID))));
  }

  /**
   * 에픽이 아닌 이슈(삭제 제외)와 가장 가까운 EPIC 조상 — {@code fullChildren} 에픽의 하위는 전부, 그 밖(상시 에픽 하위·에픽 없는 이슈 등)은
   * 이번 기간 DONE 된 것만 읽는다. 조상은 삭제되지 않은 것만 따라간다.
   */
  private List<Child> children(
      long pid, Set<Long> fullChildren, OffsetDateTime from, OffsetDateTime to) {
    var ownType = ISSUE_TYPE_DEF.as("rpe_own_type");
    var p1 = ISSUE.as("rpe_p1");
    var p2 = ISSUE.as("rpe_p2");
    var p3 = ISSUE.as("rpe_p3");
    var t1 = ISSUE_TYPE_DEF.as("rpe_t1");
    var t2 = ISSUE_TYPE_DEF.as("rpe_t2");
    var t3 = ISSUE_TYPE_DEF.as("rpe_t3");
    // 가까운 조상부터 — 부모가 에픽이면 부모, 아니면 조부모, 아니면 증조부모(최대 3단계).
    Field<Long> epicExpr =
        DSL.when(t1.NAME.eq(EPIC_TYPE), p1.ID)
            .when(t2.NAME.eq(EPIC_TYPE), p2.ID)
            .when(t3.NAME.eq(EPIC_TYPE), p3.ID);
    Field<Long> epicId = epicExpr.as("rpe_epic_id");
    Condition doneInPeriod = closedDoneCondition(from, to);
    return dsl.select(
            ISSUE.ID,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            ISSUE.STATUS,
            PROJECT_STATUS.NAME,
            ISSUE.DUE_DATE,
            ISSUE.CREATED_AT,
            ISSUE.CLOSED_AT,
            epicId)
        .from(ISSUE)
        .join(ownType)
        .on(ownType.ID.eq(ISSUE.TYPE_ID))
        .leftJoin(PROJECT_STATUS)
        .on(PROJECT_STATUS.ID.eq(ISSUE.STATUS_ID))
        .leftJoin(p1)
        .on(p1.ID.eq(ISSUE.PARENT_ISSUE_ID).and(p1.DELETED_AT.isNull()))
        .leftJoin(t1)
        .on(t1.ID.eq(p1.TYPE_ID))
        .leftJoin(p2)
        .on(p2.ID.eq(p1.PARENT_ISSUE_ID).and(p2.DELETED_AT.isNull()))
        .leftJoin(t2)
        .on(t2.ID.eq(p2.TYPE_ID))
        .leftJoin(p3)
        .on(p3.ID.eq(p2.PARENT_ISSUE_ID).and(p3.DELETED_AT.isNull()))
        .leftJoin(t3)
        .on(t3.ID.eq(p3.TYPE_ID))
        .where(ISSUE.PROJECT_ID.eq(pid))
        .and(ISSUE.DELETED_AT.isNull())
        // 에픽 자신은 에픽에 속하지 않는다.
        .and(ownType.NAME.ne(EPIC_TYPE))
        .and(epicExpr.in(fullChildren).or(doneInPeriod))
        .fetch(
            r ->
                new Child(
                    r.get(ISSUE.ID),
                    r.get(ISSUE.NUMBER),
                    r.get(ISSUE.TITLE),
                    r.get(ISSUE.STATUS),
                    r.get(PROJECT_STATUS.NAME),
                    r.get(ISSUE.DUE_DATE),
                    r.get(ISSUE.CREATED_AT),
                    r.get(ISSUE.CLOSED_AT),
                    r.get(epicId)));
  }

  /** 이슈별 담당자(이름순, 같으면 id 순)와 AI 여부. */
  private Map<Long, List<Assignee>> assignees(List<Long> ids) {
    Map<Long, List<Assignee>> out = new HashMap<>();
    if (ids.isEmpty()) return out;
    dsl.select(ISSUE_ASSIGNEE.ISSUE_ID, USER.NAME, USER.KIND)
        .from(ISSUE_ASSIGNEE)
        .join(USER)
        .on(USER.ID.eq(ISSUE_ASSIGNEE.USER_ID))
        .where(ISSUE_ASSIGNEE.ISSUE_ID.in(ids))
        .orderBy(USER.NAME.asc(), USER.ID.asc())
        .fetch()
        .forEach(
            r ->
                out.computeIfAbsent(r.value1(), k -> new ArrayList<>())
                    .add(new Assignee(r.value2(), UserKind.AGENT.equals(r.value3()))));
    return out;
  }

  /** 출시 처리 시각이 이번·지난 기간 안인 버전 수 — [이번, 지난]. */
  private int[] releases(
      long pid,
      OffsetDateTime from,
      OffsetDateTime to,
      OffsetDateTime prevFrom,
      OffsetDateTime prevTo) {
    var r =
        dsl.select(
                DSL.count()
                    .filterWhere(
                        PROJECT_VERSION
                            .RELEASED_AT
                            .ge(from)
                            .and(PROJECT_VERSION.RELEASED_AT.lt(to))),
                DSL.count()
                    .filterWhere(
                        PROJECT_VERSION
                            .RELEASED_AT
                            .ge(prevFrom)
                            .and(PROJECT_VERSION.RELEASED_AT.lt(prevTo))))
            .from(PROJECT_VERSION)
            .where(PROJECT_VERSION.PROJECT_ID.eq(pid))
            .fetchOne();
    return new int[] {r.value1(), r.value2()};
  }

  /** 프로젝트 소유자 이름, 모르면 「프로젝트 소유자」. */
  private String ownerOrFallback(ProjectRow project) {
    if (project.ownerId() == null) return ProjectReportEpics.OWNER_FALLBACK;
    String name = userRepository.findNamesByIds(List.of(project.ownerId())).get(project.ownerId());
    return name == null || name.isBlank() ? ProjectReportEpics.OWNER_FALLBACK : name;
  }

  // ───────────────────────── 도우미 ─────────────────────────

  /** 기간 안에 DONE 으로 닫혔는가(SQL). */
  private static Condition closedDoneCondition(OffsetDateTime from, OffsetDateTime to) {
    return ISSUE
        .STATUS
        .eq(IssueStatuses.DONE)
        .and(ISSUE.CLOSED_AT.ge(from))
        .and(ISSUE.CLOSED_AT.lt(to));
  }

  /** 기간 안에 DONE 으로 닫혔는가(읽은 값). */
  private static boolean closedDoneIn(
      String status, OffsetDateTime closedAt, OffsetDateTime from, OffsetDateTime to) {
    return IssueStatuses.DONE.equals(status) && in(closedAt, from, to);
  }

  /** 시각이 [from, to) 안인가. null 은 아니다. */
  private static boolean in(OffsetDateTime t, OffsetDateTime from, OffsetDateTime to) {
    return t != null && !t.isBefore(from) && t.isBefore(to);
  }

  /** 사람만 담당하고 상태 범주가 할 일인가 — 사람이 움직여야 나아가는 일. */
  private static boolean waitingOnHuman(Child c, Map<Long, List<Assignee>> assignees) {
    List<Assignee> as = assignees.getOrDefault(c.id(), List.of());
    return IssueStatuses.TODO.equals(c.status())
        && !as.isEmpty()
        && as.stream().noneMatch(Assignee::agent);
  }

  /** 열린 이슈의 기한이 오늘보다 앞인가. */
  private static boolean overdue(Child c, LocalDate today) {
    return c.open() && c.due() != null && c.due().isBefore(today);
  }

  /** 최신 완료순(같으면 번호 역순). */
  private static Comparator<Child> latestFirst() {
    return Comparator.comparing(
            Child::closedAt, Comparator.nullsLast(Comparator.<OffsetDateTime>reverseOrder()))
        .thenComparing(Child::number, Comparator.reverseOrder());
  }

  /** DONE 하위 제목을 최신 완료순으로, 상한까지. */
  private static List<String> doneTitles(List<Child> done) {
    return ProjectReportEpics.capTitles(
        done.stream().sorted(latestFirst()).map(c -> title(c.title())).toList());
  }

  /** 「기한 내 완료」 칸 — 기한 있는 완료 에픽 중 늦지 않은 수 / 기한 있는 수, 분모 0 이면 「—」. */
  private static String onTime(List<Integer> lateDays) {
    List<Integer> withDue = lateDays.stream().filter(d -> d != null).toList();
    if (withDue.isEmpty()) return ReportNumbers.DASH;
    long ok = withDue.stream().filter(d -> d <= 0).count();
    return ok + "/" + withDue.size();
  }

  /** 본문 요약 — 공백을 접고 앞 700자. 비었으면 null. */
  private static String summary(String body) {
    String one = ReportIssueDetails.oneLine(body);
    if (one == null || one.isEmpty()) return null;
    return ReportIssueDetails.cut(one, SUMMARY_MAX);
  }

  /** 제목 한 줄. */
  private static String title(String t) {
    return ReportIssueDetails.oneLine(t);
  }

  private static String key(ProjectRow project, int number) {
    return project.key() + "-" + number;
  }
}
