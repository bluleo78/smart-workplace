package com.workplace.issue.overview;

import static com.workplace.jooq.Tables.CYCLE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_VERSION;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.PROJECT_VERSION;
import static com.workplace.jooq.Tables.USER;

import com.workplace.global.tenant.WorkspaceActive;
import com.workplace.issue.dto.IssueDueWindow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.overview.ProjectOverviewResponse.Person;
import com.workplace.issue.repository.IssueAttentionConditions;
import com.workplace.version.dto.VersionKind;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.SelectField;
import org.jooq.SortField;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 프로젝트 「개요」 탭(WP-1478) 전용 조회. 계산은 서비스가 하고 여기서는 집계·원재료만 가져온다.
 *
 * <p>쿼리 수는 이슈 수와 무관하게 고정이다(N+1 없음) — 숫자는 {@code COUNT(*) FILTER (WHERE …)} 로 한 문장에 여러 개를 센다(상위 목록
 * 담당자는 서비스가 IssueAssigneeRepository 로 한 번에 읽는다). 권한은 서비스가 {@code assertReadable} 로 먼저 본다(살아 있는
 * 프로젝트만 통과하므로 프로젝트 삭제 조건은 따로 걸지 않는다).
 *
 * <p>「작업 이슈」 범위는 {@link IssueAttentionConditions#workScope}(이슈 탭 기본 범위 — SUBTASK·EPIC 제외)다. 에픽 위젯만
 * EPIC 유형을, 최근 활동은 모든 유형을 본다.
 *
 * <p>사람은 {@link #PERSON_FIELDS} 와 {@link #person(Record)} 로 같은 모양(id·이름·종류·이 워크스페이스 활성)으로 읽는다 —
 * 아바타는 웹이 앱 전체 아바타 표에서 사용자 id 로 찾으므로 싣지 않는다.
 */
@Repository
@RequiredArgsConstructor
public class ProjectOverviewRepository {

  /** 사람이 이 워크스페이스에서 활성인가(WP-417) — 정지된 담당자·행위자를 웹이 「비활성」으로 구분한다. */
  private static final Field<Boolean> ACTIVE = WorkspaceActive.field();

  /**
   * 사람 한 명을 읽는 컬럼 — {@link #person(Record)} 와 짝. MEMBERSHIP 을 {@link #joinMembership} 으로 붙인 쿼리에서
   * 쓴다.
   */
  private static final List<SelectField<?>> PERSON_FIELDS =
      List.of(USER.ID, USER.NAME, USER.KIND, ACTIVE);

  private final DSLContext dsl;

  /** {@link #PERSON_FIELDS} 로 읽은 행 → 사람. */
  private static Person person(Record r) {
    return new Person(
        r.get(USER.ID), r.get(USER.NAME), r.get(USER.KIND), Boolean.TRUE.equals(r.get(ACTIVE)));
  }

  /** 사람 컬럼({@link #PERSON_FIELDS}) 뒤에 다른 컬럼을 붙인 select 목록. */
  private static List<SelectField<?>> personAnd(SelectField<?>... more) {
    List<SelectField<?>> out = new ArrayList<>(PERSON_FIELDS);
    out.addAll(List.of(more));
    return out;
  }

  /** 활성 판정용 멤버십 조인 — 멤버십은 RLS 밖 전역 테이블이라 이슈 행의 테넌트로 붙인다(WorkspaceActive 참조). */
  private static Condition joinMembership() {
    return WorkspaceActive.join(USER.ID, ISSUE.TENANT_ID);
  }

  /** 프로젝트의 삭제되지 않은 이슈. */
  private static Condition alive(long projectId) {
    return ISSUE.PROJECT_ID.eq(projectId).and(ISSUE.DELETED_AT.isNull());
  }

  /** 프로젝트의 작업 이슈(삭제 제외 + 이슈 탭 기본 범위). */
  static Condition work(long projectId) {
    return alive(projectId).and(IssueAttentionConditions.workScope(projectId));
  }

  /** 담당자가 하나도 없다. */
  private static Condition unassigned() {
    return DSL.notExists(
        DSL.selectOne().from(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID)));
  }

  /** 열린 작업 이슈 숫자 묶음(기한 지남은 살펴볼 이슈 숫자 {@link #attentionCounts} 하나로 센다). */
  public record OpenStats(
      int todo, int inProgress, int unassigned, int dueSoon, int dueSoonUnassigned) {}

  /**
   * 열린 이슈·마감 임박 숫자를 한 문장으로 센다.
   *
   * @param dueSoonEnd 마감 임박 마지막 날(오늘+6, 포함)
   */
  public OpenStats openStats(long projectId, LocalDate today, LocalDate dueSoonEnd) {
    Condition dueSoon = ISSUE.DUE_DATE.between(today, dueSoonEnd);
    var todo = DSL.count().filterWhere(ISSUE.STATUS.eq(IssueStatuses.TODO));
    var inProgress = DSL.count().filterWhere(ISSUE.STATUS.eq(IssueStatuses.IN_PROGRESS));
    var noAssignee = DSL.count().filterWhere(unassigned());
    var soon = DSL.count().filterWhere(dueSoon);
    var soonNoAssignee = DSL.count().filterWhere(dueSoon.and(unassigned()));
    Record r =
        dsl.select(todo, inProgress, noAssignee, soon, soonNoAssignee)
            .from(ISSUE)
            .where(work(projectId))
            .and(IssueAttentionConditions.open())
            .fetchOne();
    return new OpenStats(
        r.get(todo), r.get(inProgress), r.get(noAssignee), r.get(soon), r.get(soonNoAssignee));
  }

  /**
   * 살펴볼 이슈 숫자 묶음.
   *
   * @param union 세 묶음 중 하나 이상에 든 서로 다른 이슈 수(한 이슈가 두 묶음에 들어도 한 번)
   */
  public record AttentionCounts(int overdue, int stale, int waiting, int union) {}

  /**
   * 살펴볼 이슈 세 묶음의 total 과 합집합 수를 한 문장으로 센다 — {@code COUNT(*) FILTER (WHERE …)} 넷을 같은 작업 이슈 행 위에서 세므로
   * 묶음마다 따로 세는 것보다 표를 한 번만 훑고, 합집합도 행 단위라 겹친 이슈를 한 번만 센다.
   */
  public AttentionCounts attentionCounts(
      long projectId, Condition overdue, Condition stale, Condition waiting) {
    var overdueCount = DSL.count().filterWhere(overdue);
    var staleCount = DSL.count().filterWhere(stale);
    var waitingCount = DSL.count().filterWhere(waiting);
    var unionCount = DSL.count().filterWhere(overdue.or(stale).or(waiting));
    Record r =
        dsl.select(overdueCount, staleCount, waitingCount, unionCount)
            .from(ISSUE)
            .where(work(projectId))
            .fetchOne();
    return new AttentionCounts(
        r.get(overdueCount), r.get(staleCount), r.get(waitingCount), r.get(unionCount));
  }

  /**
   * 살펴볼 이슈 한 줄 원재료.
   *
   * @param since 기준 시각(멈춘·기다린 시작) — 기한 지남은 null
   * @param dueDate 마감일 — 기한 지남만
   */
  public record AttentionRow(
      long issueId, int number, String title, OffsetDateTime since, LocalDate dueDate) {}

  /** 기한 지남 상위 — 마감 오래된 순(같으면 id 순). */
  public List<AttentionRow> topOverdue(long projectId, LocalDate today, int limit) {
    return dsl.select(ISSUE.ID, ISSUE.NUMBER, ISSUE.TITLE, ISSUE.DUE_DATE)
        .from(ISSUE)
        .where(work(projectId))
        .and(IssueAttentionConditions.overdue(today))
        .orderBy(ISSUE.DUE_DATE.asc(), ISSUE.ID.asc())
        .limit(limit)
        .fetch(
            r ->
                new AttentionRow(
                    r.get(ISSUE.ID),
                    r.get(ISSUE.NUMBER),
                    r.get(ISSUE.TITLE),
                    null,
                    r.get(ISSUE.DUE_DATE)));
  }

  /**
   * 기준 시각이 오래된 순 상위 — 오래 멈춤(마지막 움직임)·기다리는 중(기다리기 시작한 시각) 공용.
   *
   * @param since 정렬·일수 기준 시각 식({@link IssueAttentionConditions#lastMovedAt} 등)
   */
  public List<AttentionRow> topBySince(
      long projectId, Condition condition, Field<OffsetDateTime> since, int limit) {
    Field<OffsetDateTime> s = since.as("since_at");
    return dsl.select(ISSUE.ID, ISSUE.NUMBER, ISSUE.TITLE, s)
        .from(ISSUE)
        .where(work(projectId))
        .and(condition)
        .orderBy(DSL.field(DSL.name("since_at")).asc(), ISSUE.ID.asc())
        .limit(limit)
        .fetch(
            r ->
                new AttentionRow(
                    r.get(ISSUE.ID), r.get(ISSUE.NUMBER), r.get(ISSUE.TITLE), r.get(s), null));
  }

  /** 작업량 한 사람 원재료. */
  public record WorkloadRow(Person person, int count) {}

  /**
   * 열린 작업 이슈의 담당자별 수 — 많은 순(같으면 이름·id 순). 담당자가 여럿인 이슈는 각자에게 한 번씩 센다. 프로젝트에 담당자로 나오는 사람 수만큼의 행이라 전부
   * 가져와 서비스가 상위 5명과 「그 외」로 나눈다.
   */
  public List<WorkloadRow> workload(long projectId) {
    var cnt = DSL.count();
    return dsl.select(personAnd(cnt))
        .from(ISSUE_ASSIGNEE)
        .join(ISSUE)
        .on(ISSUE.ID.eq(ISSUE_ASSIGNEE.ISSUE_ID))
        .join(USER)
        .on(USER.ID.eq(ISSUE_ASSIGNEE.USER_ID))
        .leftJoin(MEMBERSHIP)
        .on(joinMembership())
        .where(work(projectId))
        .and(IssueAttentionConditions.open())
        // 활성 여부의 재료(전역 활성·멤버십 상태)는 사람·테넌트마다 하나라 묶음 키에 함께 둔다(한 프로젝트 = 한 테넌트).
        .groupBy(USER.ID, USER.NAME, USER.KIND, USER.IS_ACTIVE, MEMBERSHIP.STATUS)
        .orderBy(cnt.desc(), USER.NAME.asc(), USER.ID.asc())
        .fetch(r -> new WorkloadRow(person(r), r.get(cnt)));
  }

  /** 진행 중 대상(사이클·버전) 원재료. */
  public record TargetRow(long id, String name, LocalDate start, LocalDate end) {}

  /**
   * 진행 중(ACTIVE) 사이클 하나 — 여럿이면 종료일이 가장 가까운 것(종료일 없는 것은 뒤, 같으면 id 순). 시작일이 없으면 만든 날(서울)을 시작으로 본다.
   */
  public Optional<TargetRow> findActiveCycle(long projectId) {
    return dsl.select(CYCLE.ID, CYCLE.NAME, CYCLE.START_DATE, CYCLE.END_DATE, CYCLE.CREATED_AT)
        .from(CYCLE)
        .where(CYCLE.PROJECT_ID.eq(projectId))
        .and(CYCLE.STATUS.eq("ACTIVE"))
        .orderBy(CYCLE.END_DATE.asc().nullsLast(), CYCLE.ID.asc())
        .limit(1)
        .fetchOptional(
            r -> {
              LocalDate start = r.get(CYCLE.START_DATE);
              if (start == null) {
                start =
                    r.get(CYCLE.CREATED_AT).atZoneSameInstant(IssueDueWindow.ZONE).toLocalDate();
              }
              return new TargetRow(
                  r.get(CYCLE.ID), r.get(CYCLE.NAME), start, r.get(CYCLE.END_DATE));
            });
  }

  /**
   * 미출시 버전 하나 — 출시·보관되지 않았고 출시일이 있는 버전 중 출시일이 오늘 이후로 가장 가까운 것, 없으면 지난 것 중 가장 가까운 것. 출시일 없는 버전은 기간을
   * 정할 수 없어 후보에서 뺀다. start 는 버전 시작일 그대로(없으면 null — 서비스가 출시일 − 27일로 채운다).
   */
  public Optional<TargetRow> findUpcomingVersion(long projectId, LocalDate today) {
    Condition candidate =
        PROJECT_VERSION
            .PROJECT_ID
            .eq(projectId)
            .and(PROJECT_VERSION.RELEASED_AT.isNull())
            .and(PROJECT_VERSION.ARCHIVED_AT.isNull())
            .and(PROJECT_VERSION.RELEASE_DATE.isNotNull());
    // 오늘 이후로 가장 가까운 것, 없으면 지난 것 중 가장 가까운 것.
    Optional<TargetRow> upcoming =
        firstVersion(
            candidate.and(PROJECT_VERSION.RELEASE_DATE.ge(today)),
            PROJECT_VERSION.RELEASE_DATE.asc());
    if (upcoming.isPresent()) return upcoming;
    return firstVersion(
        candidate.and(PROJECT_VERSION.RELEASE_DATE.lt(today)), PROJECT_VERSION.RELEASE_DATE.desc());
  }

  /** 조건에 맞는 버전 중 정렬 첫 번째(같으면 id 순) — {@link #findUpcomingVersion} 의 두 후보 조회 공용. */
  private Optional<TargetRow> firstVersion(Condition condition, SortField<LocalDate> order) {
    return dsl.select(
            PROJECT_VERSION.ID,
            PROJECT_VERSION.NAME,
            PROJECT_VERSION.START_DATE,
            PROJECT_VERSION.RELEASE_DATE)
        .from(PROJECT_VERSION)
        .where(condition)
        .orderBy(order, PROJECT_VERSION.ID.asc())
        .limit(1)
        .fetchOptional(
            r ->
                new TargetRow(
                    r.get(PROJECT_VERSION.ID),
                    r.get(PROJECT_VERSION.NAME),
                    r.get(PROJECT_VERSION.START_DATE),
                    r.get(PROJECT_VERSION.RELEASE_DATE)));
  }

  /**
   * 범위 이슈 한 건 — 그래프·예상 완료 계산 원재료.
   *
   * @param addedAt 범위에 들어온 시각(사이클 연결 시각). 버전은 연결 시각 기록이 없어 null
   * @param status 범주
   * @param closedAt 닫힌 시각(DONE 이면 완료 시각)
   */
  public record ScopeRow(OffsetDateTime addedAt, String status, OffsetDateTime closedAt) {}

  /** 범위에서 빼는 것 — 취소된 이슈는 남은 일도 끝낸 일도 아니라 범위 선에 넣지 않는다. */
  private static Condition notCanceled() {
    return ISSUE.STATUS.ne(IssueStatuses.CANCELED);
  }

  /** 사이클 범위 — 사이클에 연결된 작업 이슈(취소 제외)와 연결 시각. */
  public List<ScopeRow> cycleScope(long projectId, long cycleId) {
    return dsl.select(ISSUE_CYCLE.CREATED_AT, ISSUE.STATUS, ISSUE.CLOSED_AT)
        .from(ISSUE_CYCLE)
        .join(ISSUE)
        .on(ISSUE.ID.eq(ISSUE_CYCLE.ISSUE_ID))
        .where(ISSUE_CYCLE.CYCLE_ID.eq(cycleId))
        .and(work(projectId))
        .and(notCanceled())
        .fetch(
            r ->
                new ScopeRow(
                    r.get(ISSUE_CYCLE.CREATED_AT), r.get(ISSUE.STATUS), r.get(ISSUE.CLOSED_AT)));
  }

  /** 버전 범위 — 수정 버전(FIX)으로 연결된 작업 이슈(취소 제외). */
  public List<ScopeRow> versionScope(long projectId, long versionId) {
    return dsl.select(ISSUE.STATUS, ISSUE.CLOSED_AT)
        .from(ISSUE_VERSION)
        .join(ISSUE)
        .on(ISSUE.ID.eq(ISSUE_VERSION.ISSUE_ID))
        .where(ISSUE_VERSION.VERSION_ID.eq(versionId))
        .and(ISSUE_VERSION.KIND.eq(VersionKind.FIX))
        .and(work(projectId))
        .and(notCanceled())
        .fetch(r -> new ScopeRow(null, r.get(ISSUE.STATUS), r.get(ISSUE.CLOSED_AT)));
  }

  /**
   * 시점별 열린 작업 이슈 수 — 시점 t 에 대해 created_at &lt; t 이고 (closed_at 없음 또는 closed_at ≥ t). 다시 열면
   * closed_at 이 지워지므로 지금 열린 이슈는 언제나 열린 것으로 센다. 시점마다 FILTER 하나라 한 문장이다.
   *
   * @param instants 시점들(보통 서울 날짜의 다음 날 00:00 — 그날 끝)
   */
  public List<Integer> openCountsAt(long projectId, List<OffsetDateTime> instants) {
    if (instants.isEmpty()) return List.of();
    List<Field<Integer>> fields = new ArrayList<>();
    for (OffsetDateTime t : instants) {
      fields.add(
          DSL.count()
              .filterWhere(
                  ISSUE.CREATED_AT.lt(t).and(ISSUE.CLOSED_AT.isNull().or(ISSUE.CLOSED_AT.ge(t)))));
    }
    Record r = dsl.select(fields).from(ISSUE).where(work(projectId)).fetchOne();
    List<Integer> out = new ArrayList<>();
    for (Field<Integer> f : fields) out.add(r.get(f));
    return out;
  }

  /**
   * 닫히지 않은 에픽 수.
   *
   * @param inProgress IN_PROGRESS 범주 에픽 수
   * @param total 닫히지 않은 에픽 수
   */
  public record EpicCounts(int inProgress, int total) {}

  /**
   * 닫히지 않은 에픽 수를 한 문장으로 센다.
   *
   * @param epicTypeId 프로젝트의 EPIC 유형 id(서비스가 유형 조회로 한 번 정한다)
   */
  public EpicCounts epicCounts(long projectId, long epicTypeId) {
    var inProgress = DSL.count().filterWhere(ISSUE.STATUS.eq(IssueStatuses.IN_PROGRESS));
    var total = DSL.count();
    Record r =
        dsl.select(inProgress, total)
            .from(ISSUE)
            .where(alive(projectId))
            .and(ISSUE.TYPE_ID.eq(epicTypeId))
            .and(IssueAttentionConditions.open())
            .fetchOne();
    return new EpicCounts(r.get(inProgress), r.get(total));
  }

  /** 에픽 한 줄 원재료. */
  public record EpicRow(long issueId, int number, String title) {}

  /**
   * 최근 움직인 닫히지 않은 에픽 — max(에픽 updated_at, 삭제되지 않은 자식 updated_at) 내림차순(같으면 id 큰 순). 자식의 움직임도 에픽의
   * 움직임으로 본다.
   */
  public List<EpicRow> recentEpics(long projectId, long epicTypeId, int limit) {
    var child = ISSUE.as("epic_child");
    Field<OffsetDateTime> childMoved =
        DSL.field(
            DSL.select(DSL.max(child.UPDATED_AT))
                .from(child)
                .where(child.PARENT_ISSUE_ID.eq(ISSUE.ID))
                .and(child.DELETED_AT.isNull()));
    Field<OffsetDateTime> moved = DSL.greatest(ISSUE.UPDATED_AT, childMoved);
    return dsl.select(ISSUE.ID, ISSUE.NUMBER, ISSUE.TITLE)
        .from(ISSUE)
        .where(alive(projectId))
        .and(ISSUE.TYPE_ID.eq(epicTypeId))
        .and(IssueAttentionConditions.open())
        .orderBy(moved.desc(), ISSUE.ID.desc())
        .limit(limit)
        .fetch(r -> new EpicRow(r.get(ISSUE.ID), r.get(ISSUE.NUMBER), r.get(ISSUE.TITLE)));
  }

  /** 이력 한 건 원재료(최근 활동). */
  public record HistoryRow(
      Person actor, String eventType, OffsetDateTime createdAt, int number, String title) {}

  /**
   * 프로젝트 이슈의 최근 이력 — 시각 내림차순(같으면 id 큰 순) limit 건. 삭제된 이슈 이력은 뺀다. 최근 활동은 작업 범위와 상관없이 모든 유형(에픽·하위 작업
   * 포함)을 본다 — 「무슨 일이 있었나」라서. 행위자 없는 행은 사람 정보를 그릴 수 없어 뺀다.
   */
  public List<HistoryRow> recentHistory(long projectId, int limit) {
    return dsl.select(
            personAnd(
                ISSUE_HISTORY.EVENT_TYPE, ISSUE_HISTORY.CREATED_AT, ISSUE.NUMBER, ISSUE.TITLE))
        .from(ISSUE_HISTORY)
        .join(ISSUE)
        .on(ISSUE.ID.eq(ISSUE_HISTORY.ISSUE_ID))
        .join(USER)
        .on(USER.ID.eq(ISSUE_HISTORY.ACTOR_ID))
        .leftJoin(MEMBERSHIP)
        .on(joinMembership())
        .where(alive(projectId))
        .orderBy(ISSUE_HISTORY.CREATED_AT.desc(), ISSUE_HISTORY.ID.desc())
        .limit(limit)
        .fetch(
            r ->
                new HistoryRow(
                    person(r),
                    r.get(ISSUE_HISTORY.EVENT_TYPE),
                    r.get(ISSUE_HISTORY.CREATED_AT),
                    r.get(ISSUE.NUMBER),
                    r.get(ISSUE.TITLE)));
  }
}
