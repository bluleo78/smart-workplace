package com.workplace.issue.repository;

import static com.workplace.issue.repository.IssueStatusProjection.STATUS_COLOR;
import static com.workplace.issue.repository.IssueStatusProjection.STATUS_NAME;
import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.CYCLE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;
import static com.workplace.jooq.Tables.MILESTONE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_STATUS;
import static org.jooq.impl.DSL.count;
import static org.jooq.impl.DSL.exists;
import static org.jooq.impl.DSL.noCondition;
import static org.jooq.impl.DSL.notExists;
import static org.jooq.impl.DSL.row;
import static org.jooq.impl.DSL.selectOne;

import com.workplace.global.util.LikePatternUtils;
import com.workplace.issue.dto.ChecklistCursor;
import com.workplace.issue.dto.ChecklistOrder;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueSearchQuery;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.IssueTypeSummary;
import com.workplace.issue.dto.ParentRef;
import com.workplace.issue.repository.KeysetSeek.SeekKey;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.SelectField;
import org.jooq.SortField;
import org.jooq.Table;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** issue 테이블 jOOQ 리포지토리. 모든 조회는 soft-delete(deleted_at IS NULL) 기준 활성 row 만 대상. */
@Repository
@RequiredArgsConstructor
public class IssueRepository {

  private final DSLContext dsl;

  /**
   * 연결된 마일스톤 이름(스칼라 서브쿼리) — AI 도구가 update_issue 에 그대로 쓸 수 있게 응답에 이름을 싣는다(WP-307). 유형·라벨처럼 서버가 이름을
   * 주므로 클라이언트가 마일스톤 목록을 따로 조회하지 않는다. 조회·INSERT RETURNING 모두에서 평가된다.
   */
  private static final org.jooq.Field<String> MILESTONE_NAME =
      org.jooq
          .impl
          .DSL
          .field(
              org.jooq
                  .impl
                  .DSL
                  .select(MILESTONE.NAME)
                  .from(MILESTONE)
                  .where(MILESTONE.ID.eq(ISSUE.MILESTONE_ID)))
          .as("milestone_name");

  /**
   * 이슈 + 그 프로젝트 상태(WP-870) — 상태 이름·색을 행마다 스칼라 서브쿼리로 읽지 않고 한 번의 LEFT JOIN 으로 읽는다. {@link
   * #ROW_FIELDS} 로 SELECT 하는 모든 조회의 FROM 이다(같은 패키지의 {@link AiTaskRepository} 포함).
   *
   * <p>잠그는 조회는 반드시 {@code .of(ISSUE)} 로 issue 행만 잠근다 — PostgreSQL 은 외부 조인의 nullable 쪽 잠금을 거절하고,
   * inner JOIN 으로 바꿔 project_status 행까지 잠그면 상태 삭제(project_status 잠금 → issue UPDATE)와 잠금 순서가 반대가 되어
   * 교착될 수 있다.
   */
  static final Table<?> ISSUE_WITH_STATUS = IssueStatusProjection.leftJoin(ISSUE);

  /**
   * {@link #mapToRow} 가 읽는 이슈 행 컬럼 — 조회·INSERT RETURNING 이 한 목록을 공유해 컬럼 추가 시 한 곳만 고친다. 같은 패키지의
   * {@link AiTaskRepository} 도 같은 행 모양을 쓰도록 package-private.
   */
  static final SelectField<?>[] ROW_FIELDS = {
    ISSUE.ID,
    ISSUE.PROJECT_ID,
    ISSUE.NUMBER,
    ISSUE.TITLE,
    ISSUE.BODY,
    ISSUE.STATUS,
    ISSUE.PRIORITY,
    ISSUE.DUE_DATE,
    ISSUE.REPORTER_ID,
    ISSUE.CREATED_AT,
    ISSUE.UPDATED_AT,
    ISSUE.CLOSED_AT,
    ISSUE.TYPE_ID,
    ISSUE.PARENT_ISSUE_ID,
    ISSUE.START_DATE,
    ISSUE.MILESTONE_ID,
    ISSUE.VERSION,
    MILESTONE_NAME,
    ISSUE.STATUS_ID,
    STATUS_NAME,
    STATUS_COLOR
  };

  /**
   * SELECT 결과를 {@link IssueRow} 로 매핑. OffsetDateTime → Instant 변환. typeId 는 V10 이후 NOT NULL,
   * parentIssueId 는 V11 이후 nullable.
   */
  IssueRow mapToRow(Record r) {
    OffsetDateTime created = r.get(ISSUE.CREATED_AT);
    OffsetDateTime updated = r.get(ISSUE.UPDATED_AT);
    OffsetDateTime closed = r.get(ISSUE.CLOSED_AT);
    return new IssueRow(
        r.get(ISSUE.ID),
        r.get(ISSUE.PROJECT_ID),
        r.get(ISSUE.NUMBER),
        r.get(ISSUE.TITLE),
        r.get(ISSUE.BODY),
        r.get(ISSUE.STATUS),
        r.get(ISSUE.PRIORITY),
        r.get(ISSUE.DUE_DATE),
        r.get(ISSUE.REPORTER_ID),
        created != null ? created.toInstant() : null,
        updated != null ? updated.toInstant() : null,
        closed != null ? closed.toInstant() : null,
        r.get(ISSUE.TYPE_ID),
        r.get(ISSUE.PARENT_ISSUE_ID),
        r.get(ISSUE.START_DATE),
        r.get(ISSUE.MILESTONE_ID),
        r.get(ISSUE.VERSION),
        // 마일스톤 이름·상태 이름·색은 ROW_FIELDS 로 SELECT 할 때만 있다(INSERT RETURNING 은 테이블 컬럼만) — 없으면 null.
        r.indexOf(MILESTONE_NAME) >= 0 ? r.get(MILESTONE_NAME) : null,
        r.get(ISSUE.STATUS_ID),
        r.indexOf(STATUS_NAME) >= 0 ? r.get(STATUS_NAME) : null,
        r.indexOf(STATUS_COLOR) >= 0 ? r.get(STATUS_COLOR) : null);
  }

  /**
   * #611 수정용 활성 이슈 조회 + 행 잠금(SELECT ... FOR NO KEY UPDATE — 키는 안 바뀌므로 코멘트·담당자 등 FK 참조 INSERT 는 막지
   * 않는다). 수정은 읽은 값에 요청 필드를 병합해 전 컬럼을 다시 쓰므로, 잠그지 않으면 동시에 들어온 두 수정이 같은 옛 값을 읽어 뒤에 쓴 쪽이 앞의 변경을
   * 되돌린다(version 을 보내지 않는 호출자 포함). 트랜잭션 끝까지 유지된다.
   */
  public Optional<IssueRow> findByProjectAndNumberForUpdate(Long projectId, int number) {
    return dsl.select(ROW_FIELDS)
        .from(ISSUE_WITH_STATUS)
        .where(
            ISSUE
                .PROJECT_ID
                .eq(projectId)
                .and(ISSUE.NUMBER.eq(number))
                .and(ISSUE.DELETED_AT.isNull()))
        .forNoKeyUpdate()
        .of(ISSUE)
        .fetchOptional(this::mapToRow);
  }

  /**
   * 새 부모로 지정할 활성 이슈 조회 + 공유 잠금(SELECT ... FOR SHARE, WP-759). 에픽 삭제는 그 행을 FOR NO KEY UPDATE 로 잠그므로,
   * 삭제가 진행 중이면 커밋까지 기다렸다가 deleted_at 을 다시 보고 빈 결과가 된다 — 잠그지 않으면 삭제 직후 지워진 에픽을 부모로 가리킨 채 남았다(외래 키는
   * soft-delete 라 통과). 반대로 이 잠금을 쥔 동안에는 삭제가 기다렸다가 새로 붙은 하위까지 함께 지운다. 트랜잭션 끝까지 유지된다.
   */
  public Optional<IssueRow> findByProjectAndNumberForShare(Long projectId, int number) {
    return dsl.select(ROW_FIELDS)
        .from(ISSUE_WITH_STATUS)
        .where(
            ISSUE
                .PROJECT_ID
                .eq(projectId)
                .and(ISSUE.NUMBER.eq(number))
                .and(ISSUE.DELETED_AT.isNull()))
        .forShare()
        .of(ISSUE)
        .fetchOptional(this::mapToRow);
  }

  /**
   * id 의 활성 이슈를 공유 잠금으로 다시 읽는다(WP-759, {@link #findByProjectAndNumberForShare} 와 같은 이유). 지워졌으면 빈
   * 결과. 잠금을 기다린 뒤의 최신 행이라, 그 사이 완료로 바뀐 에픽도 알 수 있다(WP-771).
   */
  public Optional<IssueRow> findActiveByIdForShare(Long id) {
    return dsl.select(ROW_FIELDS)
        .from(ISSUE_WITH_STATUS)
        .where(ISSUE.ID.eq(id).and(ISSUE.DELETED_AT.isNull()))
        .forShare()
        .of(ISSUE)
        .fetchOptional(this::mapToRow);
  }

  /**
   * id 의 활성 이슈를 쓰기 잠금(FOR UPDATE)으로 잡는다(WP-771) — 하위를 다시 열 때 그 부모 에픽을 하위보다 먼저 잠가, 에픽 완료·삭제와 같은
   * 순서(부모→하위)로 차례를 세운다. 지워졌으면 빈 결과.
   */
  public Optional<Long> lockActiveByIdForUpdate(Long id) {
    return dsl.select(ISSUE.ID)
        .from(ISSUE)
        .where(ISSUE.ID.eq(id).and(ISSUE.DELETED_AT.isNull()))
        .forUpdate()
        .fetchOptional(ISSUE.ID);
  }

  /** id 로 활성 이슈 조회. */
  public Optional<IssueRow> findById(Long id) {
    return dsl.select(ROW_FIELDS)
        .from(ISSUE_WITH_STATUS)
        .where(ISSUE.ID.eq(id).and(ISSUE.DELETED_AT.isNull()))
        .fetchOptional(this::mapToRow);
  }

  /** id 들로 활성(삭제 아님) 이슈를 한 번에 조회 — N+1 회피. 없는 id 는 결과에서 빠진다. */
  public List<IssueRow> findByIds(Collection<Long> ids) {
    if (ids == null || ids.isEmpty()) return List.of();
    return dsl.select(ROW_FIELDS)
        .from(ISSUE_WITH_STATUS)
        .where(ISSUE.ID.in(ids).and(ISSUE.DELETED_AT.isNull()))
        .fetch(this::mapToRow);
  }

  /** projectId + number 로 활성 이슈 조회. */
  public Optional<IssueRow> findByProjectAndNumber(Long projectId, int number) {
    return dsl.select(ROW_FIELDS)
        .from(ISSUE_WITH_STATUS)
        .where(
            ISSUE
                .PROJECT_ID
                .eq(projectId)
                .and(ISSUE.NUMBER.eq(number))
                .and(ISSUE.DELETED_AT.isNull()))
        .fetchOptional(this::mapToRow);
  }

  /** 프로젝트 내 활성 이슈를 updated_at desc 정렬로 페이지 조회. */
  public List<IssueRow> findByProject(Long projectId, int page, int size) {
    return dsl.select(ROW_FIELDS)
        .from(ISSUE_WITH_STATUS)
        .where(ISSUE.PROJECT_ID.eq(projectId).and(ISSUE.DELETED_AT.isNull()))
        .orderBy(ISSUE.UPDATED_AT.desc())
        .limit(size)
        .offset((long) page * size)
        .fetch(this::mapToRow);
  }

  /** 프로젝트 내 활성 이슈 총 개수. */
  public long countByProject(Long projectId) {
    return dsl.select(count())
        .from(ISSUE)
        .where(ISSUE.PROJECT_ID.eq(projectId).and(ISSUE.DELETED_AT.isNull()))
        .fetchOne(0, Long.class);
  }

  /**
   * 신규 이슈 INSERT 후 생성된 row 반환 — 운영 코드의 유일한 생성 경로다(범주만 받던 호환 오버로드는 테스트 IssueSeeds 로 옮김, WP-937).
   * 담당자는 별도 매핑(issue_assignee). typeId 는 호출자가 정하고, parentIssueId 는 SUBTASK 일 때만 non-null 이며 정합성은
   * 서비스가 가드한다. 처음 상태를 범주·프로젝트 상태 id 로 지정한다(WP-807). 둘은 같은 상태를 가리켜야 한다(복합 FK 가 어긋남을 거절). 종료 범주(DONE·
   * CANCELED)면 closed_at 을 지금으로 채운다 — 상태 변경 경로의 종료 진입 규칙과 같다.
   *
   * <p>INSERT RETURNING 은 테이블 컬럼만 돌려줘 조인 컬럼(상태 이름·색)과 마일스톤 이름이 빠진다 — 호출자가 이미 검증하며 읽은 상태 이름·색과 마일스톤
   * 이름을 받아 채운다. 그래서 INSERT 뒤 이슈를 다시 조회하지 않는다(WP-870).
   */
  public IssueRow insert(
      Long projectId,
      int number,
      String title,
      String body,
      String priority,
      LocalDate dueDate,
      Long reporterId,
      Long typeId,
      Long parentIssueId,
      LocalDate startDate,
      Long milestoneId,
      String status,
      long statusId,
      String statusName,
      String statusColor,
      String milestoneName) {
    var insert =
        dsl.insertInto(ISSUE)
            .set(ISSUE.PROJECT_ID, projectId)
            .set(ISSUE.NUMBER, number)
            .set(ISSUE.TITLE, title)
            .set(ISSUE.BODY, body)
            .set(ISSUE.PRIORITY, priority)
            .set(ISSUE.DUE_DATE, dueDate)
            .set(ISSUE.START_DATE, startDate)
            .set(ISSUE.REPORTER_ID, reporterId)
            .set(ISSUE.TYPE_ID, typeId)
            .set(ISSUE.PARENT_ISSUE_ID, parentIssueId)
            .set(ISSUE.MILESTONE_ID, milestoneId)
            .set(ISSUE.STATUS, status)
            .set(ISSUE.STATUS_ID, statusId);
    if (IssueStatuses.isClosed(status)) {
      insert = insert.set(ISSUE.CLOSED_AT, OffsetDateTime.now());
    }
    IssueRow inserted =
        insert
            .returning(ISSUE.fields())
            .fetchOptional(this::mapToRow)
            .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
    // RETURNING 에 없는 이름 컬럼만 채운 사본 — 나머지는 DB 가 돌려준 값(기본값·트리거 반영) 그대로다.
    return new IssueRow(
        inserted.id(),
        inserted.projectId(),
        inserted.number(),
        inserted.title(),
        inserted.body(),
        inserted.status(),
        inserted.priority(),
        inserted.dueDate(),
        inserted.reporterId(),
        inserted.createdAt(),
        inserted.updatedAt(),
        inserted.closedAt(),
        inserted.typeId(),
        inserted.parentIssueId(),
        inserted.startDate(),
        inserted.milestoneId(),
        inserted.version(),
        milestoneName,
        inserted.statusId(),
        statusName,
        statusColor);
  }

  /**
   * 모든 변경 가능 필드 일괄 갱신. updated_at = now(), version + 1(#611). closedAt 은 호출자가 계산하여 전달. type 변경은 별도
   * {@link #updateType}. status(범주)와 statusId(프로젝트 상태)는 같은 상태를 가리켜야 한다(WP-807, 복합 FK).
   */
  public void updateAll(
      Long id,
      String title,
      String body,
      String status,
      long statusId,
      String priority,
      LocalDate dueDate,
      LocalDate startDate,
      Long milestoneId,
      java.time.Instant closedAt) {
    dsl.update(ISSUE)
        .set(ISSUE.TITLE, title)
        .set(ISSUE.BODY, body)
        .set(ISSUE.STATUS, status)
        .set(ISSUE.STATUS_ID, statusId)
        .set(ISSUE.PRIORITY, priority)
        .set(ISSUE.DUE_DATE, dueDate)
        .set(ISSUE.START_DATE, startDate)
        .set(ISSUE.MILESTONE_ID, milestoneId)
        .set(ISSUE.CLOSED_AT, closedAt != null ? closedAt.atOffset(java.time.ZoneOffset.UTC) : null)
        .set(ISSUE.UPDATED_AT, OffsetDateTime.now())
        .set(ISSUE.VERSION, ISSUE.VERSION.plus(1))
        .where(ISSUE.ID.eq(id))
        .execute();
  }

  /**
   * 유형만 갱신 — updated_at 동기. 서비스에서 fast-return / history 기록과 함께 사용. version 은 올리지 않는다(#611 — PATCH 가
   * 덮어쓰는 필드가 아니라 lost-update 대상이 아니고, 올리면 제목·본문 편집 중 유형만 바꿔도 저장이 거짓 409 가 된다).
   */
  public void updateType(Long id, Long newTypeId) {
    dsl.update(ISSUE)
        .set(ISSUE.TYPE_ID, newTypeId)
        .set(ISSUE.UPDATED_AT, OffsetDateTime.now())
        .where(ISSUE.ID.eq(id))
        .execute();
  }

  /**
   * 부모(SUBTASK) 갱신 — newParentId null 이면 해제. updated_at 동기. version 은 올리지 않는다({@link #updateType} 과
   * 같은 이유). (Phase 4a)
   */
  public void updateParent(Long id, Long newParentId) {
    dsl.update(ISSUE)
        .set(ISSUE.PARENT_ISSUE_ID, newParentId)
        .set(ISSUE.UPDATED_AT, OffsetDateTime.now())
        .where(ISSUE.ID.eq(id))
        .execute();
  }

  /**
   * 사이클 필터 조건 — search·searchMemberOf 두 경로가 공유해 결과가 어긋나지 않게 한다. 지정 사이클 중 하나라도 연결(EXISTS) 또는
   * includeNoOpenCycle(백로그) 이면 진행 중(ACTIVE)·예정(PLANNED) 사이클 연결이 없는(NOT EXISTS) 이슈를 OR 로 매칭한다(#878).
   * 완료(COMPLETED) 사이클 연결만 있는 이슈는 백로그로 본다 — 끝난 스프린트의 미완료 이슈가 백로그로 돌아오는 Jira 관례. includeNoCycle 이면
   * 사이클 연결이 하나도 없는 이슈를 OR 로 매칭한다(WP-176). 셋 다 없으면 조건 미적용.
   */
  private org.jooq.Condition cycleCondition(com.workplace.issue.dto.IssueSearchQuery query) {
    org.jooq.Condition cond = noCondition();
    if (query.cycleIds() != null && !query.cycleIds().isEmpty()) {
      // IN 을 포함한 단일 EXISTS — 지정 사이클 중 하나라도 연결된 이슈
      cond =
          cond.or(
              exists(
                  dsl.selectOne()
                      .from(ISSUE_CYCLE)
                      .where(
                          ISSUE_CYCLE
                              .ISSUE_ID
                              .eq(ISSUE.ID)
                              .and(ISSUE_CYCLE.CYCLE_ID.in(query.cycleIds())))));
    }
    if (query.includeNoOpenCycle()) {
      // 백로그 — 진행 중·예정 사이클과의 M:N 연결이 하나도 없는 이슈(연결 없음 + 완료 사이클에만 연결).
      cond =
          cond.or(
              notExists(
                  dsl.selectOne()
                      .from(ISSUE_CYCLE)
                      .join(CYCLE)
                      .on(CYCLE.ID.eq(ISSUE_CYCLE.CYCLE_ID))
                      .where(
                          ISSUE_CYCLE
                              .ISSUE_ID
                              .eq(ISSUE.ID)
                              .and(CYCLE.STATUS.in("ACTIVE", "PLANNED")))));
    }
    if (query.includeNoCycle()) {
      // 사이클 미할당 — 상태 무관하게 M:N 연결이 하나도 없는 이슈(완료 사이클에만 연결된 이슈는 제외).
      cond =
          cond.or(
              notExists(
                  dsl.selectOne().from(ISSUE_CYCLE).where(ISSUE_CYCLE.ISSUE_ID.eq(ISSUE.ID))));
    }
    return cond;
  }

  /**
   * 단일 프로젝트 검색 필터 조건(cursor 제외) — 목록(search)·그룹 총계(countGrouped, WP-472)·체크리스트 정렬(searchChecklist,
   * WP-918)이 같은 조건을 쓰게 한 곳에 둔다. 따로 만들면 필터 하나만 바뀌어도 헤더 수와 목록이 어긋난다.
   */
  private org.jooq.Condition projectFilterCondition(
      Long projectId, com.workplace.issue.dto.IssueSearchQuery query) {
    org.jooq.Condition where = ISSUE.PROJECT_ID.eq(projectId).and(ISSUE.DELETED_AT.isNull());

    if (query.q() != null && !query.q().isBlank()) {
      // 검색어의 %·_·\ 는 글자 그대로 찾는다(WP-471 — 그대로 넣으면 와일드카드가 돼 전체가 나왔다).
      String pattern = LikePatternUtils.containsPattern(query.q().trim());
      where =
          where.and(
              ISSUE
                  .TITLE
                  .likeIgnoreCase(pattern, '\\')
                  .or(ISSUE.BODY.likeIgnoreCase(pattern, '\\')));
    }
    if (query.statuses() != null && !query.statuses().isEmpty()) {
      where = where.and(ISSUE.STATUS.in(query.statuses()));
    }
    // WP-807 개별 상태 — 범주(statuses)와 AND, 상태 id 끼리는 OR.
    if (query.statusIds() != null && !query.statusIds().isEmpty()) {
      where = where.and(ISSUE.STATUS_ID.in(query.statusIds()));
    }
    if (Boolean.TRUE.equals(query.hideInactiveClosed())) {
      // #876 — 종료(DONE·CANCELED) 이슈는 ACTIVE 사이클에 연결된 경우에만 남긴다. 미종료 이슈는 그대로 통과.
      // 사이클은 프로젝트 스코프라 이슈에 연결된 사이클은 모두 같은 프로젝트 소속 — 프로젝트 조건 불필요.
      where =
          where.and(
              ISSUE
                  .STATUS
                  .notIn(IssueStatuses.CLOSED)
                  .or(
                      exists(
                          dsl.selectOne()
                              .from(ISSUE_CYCLE)
                              .join(CYCLE)
                              .on(CYCLE.ID.eq(ISSUE_CYCLE.CYCLE_ID))
                              .where(
                                  ISSUE_CYCLE
                                      .ISSUE_ID
                                      .eq(ISSUE.ID)
                                      .and(CYCLE.STATUS.eq("ACTIVE"))))));
    }
    if (query.priorities() != null && !query.priorities().isEmpty()) {
      where = where.and(ISSUE.PRIORITY.in(query.priorities()));
    }
    if (query.reporterIds() != null && !query.reporterIds().isEmpty()) {
      // reporter(이슈 생성자) 직접 컬럼 비교 — issue_assignee 매핑과 무관.
      where = where.and(ISSUE.REPORTER_ID.in(query.reporterIds()));
    }
    boolean hasAssigneeList = query.assigneeIds() != null && !query.assigneeIds().isEmpty();
    if (hasAssigneeList || query.includeUnassigned()) {
      // issue_assignee 매핑 기반 EXISTS/NOT EXISTS — Phase 3c 단일컷 후 다중 담당자 구조에 맞춘 필터.
      org.jooq.Condition cond = org.jooq.impl.DSL.noCondition();
      if (hasAssigneeList) {
        cond =
            cond.or(
                org.jooq.impl.DSL.exists(
                    dsl.selectOne()
                        .from(com.workplace.jooq.Tables.ISSUE_ASSIGNEE)
                        .where(
                            com.workplace.jooq.Tables.ISSUE_ASSIGNEE
                                .ISSUE_ID
                                .eq(ISSUE.ID)
                                .and(
                                    com.workplace.jooq.Tables.ISSUE_ASSIGNEE.USER_ID.in(
                                        query.assigneeIds())))));
      }
      if (query.includeUnassigned()) {
        cond =
            cond.or(
                org.jooq.impl.DSL.notExists(
                    dsl.selectOne()
                        .from(com.workplace.jooq.Tables.ISSUE_ASSIGNEE)
                        .where(com.workplace.jooq.Tables.ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID))));
      }
      where = where.and(cond);
    }
    where = where.and(dateRangeCondition(query));
    where = where.and(watcherCondition(query));
    where = where.and(pendingForCondition(query));
    where = where.and(labelGroupsCondition(query.labelIdGroups()));
    where = where.and(cycleCondition(query));
    if (query.milestoneIds() != null && !query.milestoneIds().isEmpty()) {
      // 마일스톤은 issue.milestone_id 직접 컬럼 — OR 결합(IN), M:N 아니라 EXISTS 불필요
      where = where.and(ISSUE.MILESTONE_ID.in(query.milestoneIds()));
    }
    if (query.typeIds() != null && !query.typeIds().isEmpty()) {
      where = where.and(ISSUE.TYPE_ID.in(query.typeIds()));
    }
    // Phase 4a — parentNumber 가 지정되면 해당 부모의 자식만. 아니면 topLevel(루트만) /
    // excludeSubtasks(SUBTASK 유형 제외) / excludeEpics(EPIC 유형 제외) 를 적용한다. 셋은 직교하며 AND 결합되지만,
    // parentNumber 로 특정 부모의 자식을 볼 때는 모두 무시한다(자식을 숨기면 결과가 비므로).
    if (query.parentNumber() != null) {
      Long parentId =
          dsl.select(ISSUE.ID)
              .from(ISSUE)
              .where(
                  ISSUE
                      .PROJECT_ID
                      .eq(projectId)
                      .and(ISSUE.NUMBER.eq(query.parentNumber()))
                      .and(ISSUE.DELETED_AT.isNull()))
              .fetchOptional(0, Long.class)
              .orElse(-1L);
      where = where.and(ISSUE.PARENT_ISSUE_ID.eq(parentId));
    } else {
      if (Boolean.TRUE.equals(query.topLevel())) {
        where = where.and(ISSUE.PARENT_ISSUE_ID.isNull());
      }
      // 유형 이름 기준 제외 — SUBTASK 는 부모 해제된 고아(parent_issue_id IS NULL)까지 함께 차단되고(에픽 직속
      // 자식 등 비SUBTASK 는 유지), EPIC 은 보드·목록 기본 뷰에서 숨긴다(에픽 패널·타임라인이 담당).
      // 프로젝트에 해당 유형이 없으면(PERSONAL) 서브쿼리가 비어 NOT IN 이 전체 참 → 아무것도 제외 안 함.
      List<String> excludedTypeNames = new ArrayList<>(2);
      if (Boolean.TRUE.equals(query.excludeSubtasks())) excludedTypeNames.add("SUBTASK");
      if (Boolean.TRUE.equals(query.excludeEpics())) excludedTypeNames.add("EPIC");
      if (!excludedTypeNames.isEmpty()) {
        where =
            where.and(
                ISSUE.TYPE_ID.notIn(
                    dsl.select(ISSUE_TYPE_DEF.ID)
                        .from(ISSUE_TYPE_DEF)
                        .where(
                            ISSUE_TYPE_DEF
                                .PROJECT_ID
                                .eq(projectId)
                                .and(ISSUE_TYPE_DEF.NAME.in(excludedTypeNames)))));
      }
    }
    // Phase 4b — blocked=true: 활성 차단자(미완료, 미삭제)가 존재하는 이슈만. 자기참조 회피를 위해 blocker self-alias 사용.
    // 대상 이슈 자신이 이미 DONE/CANCELED 면 차단자가 남아있어도 blocked=false 로 취급한다 (#826).
    if (Boolean.TRUE.equals(query.blocked())) {
      var blockerAlias = ISSUE.as("blocker");
      where =
          where
              .and(ISSUE.STATUS.notIn(IssueStatuses.CLOSED))
              .and(
                  org.jooq.impl.DSL.exists(
                      dsl.selectOne()
                          .from(com.workplace.jooq.Tables.ISSUE_DEPENDENCY)
                          .join(blockerAlias)
                          .on(
                              blockerAlias.ID.eq(
                                  com.workplace.jooq.Tables.ISSUE_DEPENDENCY.ISSUE_ID))
                          .where(
                              com.workplace.jooq.Tables.ISSUE_DEPENDENCY
                                  .BLOCKS_ISSUE_ID
                                  .eq(ISSUE.ID)
                                  .and(blockerAlias.STATUS.notIn(IssueStatuses.CLOSED))
                                  .and(blockerAlias.DELETED_AT.isNull()))));
    }
    // Phase 4c — custom field 단일 동등 비교 필터 (fieldId+fieldValue 동시 지정 시). JSONB 를 텍스트로 캐스트하여 비교.
    if (query.fieldId() != null && query.fieldValue() != null) {
      where =
          where.and(
              org.jooq.impl.DSL.exists(
                  dsl.selectOne()
                      .from(com.workplace.jooq.Tables.ISSUE_FIELD_VALUE)
                      .where(
                          com.workplace.jooq.Tables.ISSUE_FIELD_VALUE
                              .ISSUE_ID
                              .eq(ISSUE.ID)
                              .and(
                                  com.workplace.jooq.Tables.ISSUE_FIELD_VALUE.FIELD_DEF_ID.eq(
                                      query.fieldId()))
                              .and(
                                  com.workplace.jooq.Tables.ISSUE_FIELD_VALUE
                                      .VALUE
                                      .cast(String.class)
                                      .eq(query.fieldValue())))));
    }
    return where;
  }

  /**
   * 검색 필터에 걸리는 이슈를 그룹별로 센다(WP-472) — 목록 그룹 헤더의 정확한 수. 키는 status·priority 값, statusId 는 상태 id
   * 문자열(WP-807), assignee 는 담당자 user id 문자열(담당자가 여럿이면 각자에 한 번씩 — 목록 그룹과 같다)이고 담당자 없는 이슈는 null 키로
   * 센다. 0건인 그룹은 돌려주지 않는다.
   */
  public java.util.Map<String, Integer> countGrouped(
      Long projectId, com.workplace.issue.dto.IssueSearchQuery query, String groupBy) {
    org.jooq.Condition where = projectFilterCondition(projectId, query);
    java.util.Map<String, Integer> out = new java.util.LinkedHashMap<>();
    switch (groupBy) {
      case "status", "priority" -> {
        var field = "status".equals(groupBy) ? ISSUE.STATUS : ISSUE.PRIORITY;
        dsl.select(field, org.jooq.impl.DSL.count())
            .from(ISSUE)
            .where(where)
            .groupBy(field)
            .forEach(r -> out.put(r.value1(), r.value2()));
      }
      case "statusId" -> {
        // WP-807 개별 상태별 — 키는 상태 id 문자열.
        dsl.select(ISSUE.STATUS_ID, org.jooq.impl.DSL.count())
            .from(ISSUE)
            .where(where)
            .groupBy(ISSUE.STATUS_ID)
            .forEach(r -> out.put(String.valueOf(r.value1()), r.value2()));
      }
      case "assignee" -> {
        dsl.select(ISSUE_ASSIGNEE.USER_ID, org.jooq.impl.DSL.count())
            .from(ISSUE)
            .join(ISSUE_ASSIGNEE)
            .on(ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID))
            .where(where)
            .groupBy(ISSUE_ASSIGNEE.USER_ID)
            .forEach(r -> out.put(String.valueOf(r.value1()), r.value2()));
        int unassigned =
            dsl.fetchCount(
                ISSUE,
                where.and(
                    org.jooq.impl.DSL.notExists(
                        org.jooq
                            .impl
                            .DSL
                            .selectOne()
                            .from(ISSUE_ASSIGNEE)
                            .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID)))));
        if (unassigned > 0) out.put(null, unassigned);
      }
      default -> throw new IllegalArgumentException("groupBy: " + groupBy);
    }
    return out;
  }

  /**
   * 검색/필터 + cursor 페이징. 활성(deleted_at IS NULL) 이슈만 대상. 정렬은 (updated_at DESC, id DESC) 고정. size 는
   * 호출자가 1..100 으로 클램프한 값을 넘긴다. assignee 필터는 issue_assignee 매핑에 대한 EXISTS/NOT EXISTS 로 변환된다.
   * typeIds 는 OR 결합. Phase 4a: parentNumber/topLevel 필터.
   */
  public List<IssueRow> search(Long projectId, com.workplace.issue.dto.IssueSearchQuery query) {
    org.jooq.Condition where = projectFilterCondition(projectId, query);
    if (query.cursor() != null) {
      var ts = query.cursor().updatedAt().atOffset(java.time.ZoneOffset.UTC);
      var cursorId = query.cursor().id();
      // (updated_at, id) < (cursorTs, cursorId) — 동일 updated_at 인 경우 id 로 tie-break
      where =
          where.and(ISSUE.UPDATED_AT.lt(ts).or(ISSUE.UPDATED_AT.eq(ts).and(ISSUE.ID.lt(cursorId))));
    }

    return dsl.select(ROW_FIELDS)
        .from(ISSUE_WITH_STATUS)
        .where(where)
        .orderBy(ISSUE.UPDATED_AT.desc(), ISSUE.ID.desc())
        .limit(query.size())
        .fetch(this::mapToRow);
  }

  /** 체크리스트 정렬(WP-918) 센티널 — 마감 없음 자리를 가장 이른 날짜로 채워 NULL 없이 비교하고 같은 우선순위 안에서 맨 앞에 둔다. */
  static final LocalDate CHECKLIST_NO_DUE = LocalDate.of(1, 1, 1);

  /**
   * 체크리스트 정렬 행 — 다음 커서를 만들 수 있게 정렬 키(섹션 k1, 우선순위 순위, 마감)를 함께 싣는다.
   *
   * @param k1 섹션 순위(모드별 — {@link #searchChecklist} 참고)
   * @param prio 우선순위 순위(HIGH 0, MID 1, 그 밖 2)
   * @param due 마감(없으면 {@link #CHECKLIST_NO_DUE})
   */
  public record ChecklistRow(IssueRow row, int k1, int prio, LocalDate due) {

    /** 이 행 다음부터 이어 읽는 커서 — 정렬 키를 그대로 옮긴다. */
    public ChecklistCursor toCursor() {
      return new ChecklistCursor(k1, prio, due, row.id());
    }
  }

  /**
   * 개인 작업 목록 체크리스트 정렬 한 페이지(WP-918, opt-in). 범위·필터는 {@link #search} 와 같고({@link
   * #projectFilterCondition}), 정렬만 화면 섹션 순서 → 우선순위 → 마감 → id (모두 ASC)다. 클라이언트가 페이지를 이어 붙여도 섹션이
   * 되돌아가지 않게 서버가 섹션 순서대로 내린다.
   *
   * <p>정렬 키는 파생 테이블 한 단에서 계산하고 NULL 이 없다(마감 없음은 센티널) — {@link KeysetSeek} 의 lt·eq 비교가 NULL 이 되지 않게.
   * ORDER BY 와 seek 는 같은 키 목록에서 만든다.
   *
   * <ul>
   *   <li>DUE: 닫힘 5, 마감 없음 4, 지남 0, 오늘 1, weekEnd 까지 2, 그 뒤 3 — 클라이언트 groupByDue 와 같은 경계(날짜는 클라이언트
   *       로컬).
   *   <li>STATUS: TODO 0, IN_PROGRESS 1, DONE 2, 그 밖(CANCELED) 3.
   *   <li>PRIORITY: 취소 1, 그 밖 0 — 섹션 안 우선순위 순은 prio 가 맡는다.
   * </ul>
   *
   * @param cursor 이전 페이지 마지막 행의 커서, 첫 페이지면 null
   */
  public List<ChecklistRow> searchChecklist(
      Long projectId, IssueSearchQuery query, ChecklistOrder order, ChecklistCursor cursor) {
    // 우선순위 enum 문자열은 알파벳순이 화면 순서(HIGH→MID→LOW)와 달라 CASE 로 순위를 매긴다.
    Field<Integer> prioCase =
        DSL.when(ISSUE.PRIORITY.eq("HIGH"), DSL.inline(0))
            .when(ISSUE.PRIORITY.eq("MID"), DSL.inline(1))
            .otherwise(DSL.inline(2));
    Field<LocalDate> dueKey = DSL.coalesce(ISSUE.DUE_DATE, DSL.inline(CHECKLIST_NO_DUE));

    Table<?> t =
        dsl.select(
                ISSUE.ID.as("ck_id"),
                checklistSection(order).as("ck_k1"),
                prioCase.as("ck_prio"),
                dueKey.as("ck_due"))
            .from(ISSUE)
            .where(projectFilterCondition(projectId, query))
            .asTable("ck");
    Field<Long> id = t.field("ck_id", Long.class);
    Field<Integer> k1 = t.field("ck_k1", Integer.class);
    Field<Integer> prio = t.field("ck_prio", Integer.class);
    Field<LocalDate> due = t.field("ck_due", LocalDate.class);

    ChecklistCursor c = cursor;
    List<SeekKey<?>> keys =
        List.of(
            SeekKey.asc(k1, c == null ? null : c.k1()),
            SeekKey.asc(prio, c == null ? null : c.prio()),
            SeekKey.asc(due, c == null ? null : c.due()),
            SeekKey.asc(id, c == null ? null : c.id()));
    List<SortField<?>> orderBy = keys.stream().<SortField<?>>map(k -> k.field().asc()).toList();
    Condition seek = c == null ? noCondition() : KeysetSeek.after(keys);

    List<SelectField<?>> fields = new ArrayList<>(List.of(ROW_FIELDS));
    fields.addAll(List.of(k1, prio, due));
    // 바깥 행 컬럼(ROW_FIELDS)의 상태 이름·색은 상태 조인에서 읽는다(WP-870) — 정렬 키 파생 테이블은 issue 만 본다
    return dsl.select(fields)
        .from(ISSUE_WITH_STATUS)
        .join(t)
        .on(id.eq(ISSUE.ID))
        .where(seek)
        .orderBy(orderBy)
        .limit(query.size())
        .fetch(r -> new ChecklistRow(mapToRow(r), r.get(k1), r.get(prio), r.get(due)));
  }

  /** 체크리스트 정렬의 섹션 순위 식 — 모드별 화면 섹션 순서. 규칙은 {@link #searchChecklist} 참고. */
  private static Field<Integer> checklistSection(ChecklistOrder order) {
    return switch (order.mode()) {
      case DUE ->
          DSL.when(ISSUE.STATUS.in(IssueStatuses.CLOSED), DSL.inline(5))
              .when(ISSUE.DUE_DATE.isNull(), DSL.inline(4))
              .when(ISSUE.DUE_DATE.lt(order.today()), DSL.inline(0))
              .when(ISSUE.DUE_DATE.eq(order.today()), DSL.inline(1))
              .when(ISSUE.DUE_DATE.le(order.weekEnd()), DSL.inline(2))
              .otherwise(DSL.inline(3));
      case STATUS ->
          DSL.when(ISSUE.STATUS.eq(IssueStatuses.TODO), DSL.inline(0))
              .when(ISSUE.STATUS.eq(IssueStatuses.IN_PROGRESS), DSL.inline(1))
              .when(ISSUE.STATUS.eq(IssueStatuses.DONE), DSL.inline(2))
              .otherwise(DSL.inline(3));
      case PRIORITY ->
          DSL.when(ISSUE.STATUS.eq(IssueStatuses.CANCELED), DSL.inline(1)).otherwise(DSL.inline(0));
    };
  }

  /**
   * 워치 필터(WP-356) — 단일/횡단 검색 공용. watcherId 의 issue_watcher 행이 있는 이슈만. 예전엔 /me/watched-issues 만 있어
   * 다른 필터와 함께 쓸 수 없었고 응답에 담당자·유형이 빠졌다 — 검색 필터로 두면 같은 응답·커서·필터 조합을 그대로 쓴다.
   */
  private Condition watcherCondition(IssueSearchQuery query) {
    if (query.watcherId() == null) return noCondition();
    return exists(
        dsl.selectOne()
            .from(ISSUE_WATCHER)
            .where(
                ISSUE_WATCHER
                    .ISSUE_ID
                    .eq(ISSUE.ID)
                    .and(ISSUE_WATCHER.USER_ID.eq(query.watcherId()))));
  }

  /**
   * 새 글 필터(WP-373) — 단일/횡단 검색 공용. 이슈 스레드에 삭제되지 않은 다른 사람의 글 m 이 있고, 그 뒤(created_at, id 순서 —
   * afterMine·after 와 같은 정렬)에 이 사용자의 삭제되지 않은 글이 없으면 해당. 이 사용자가 쓴 적이 없으면 NOT EXISTS 가 참이라 다른 사람 글이
   * 하나라도 있을 때 해당한다. created_at 이 같아도 id 로 순서가 정해지도록 행 비교를 쓴다. 마지막 글은
   * idx_chat_message_thread_created(thread_id, created_at DESC, id DESC)로 찾는다.
   */
  private Condition pendingForCondition(IssueSearchQuery query) {
    Long uid = query.pendingForUserId();
    if (uid == null) return noCondition();
    var mine = CHAT_MESSAGE.as("pending_mine");
    return exists(
        selectOne()
            .from(CHAT_THREAD)
            .join(CHAT_MESSAGE)
            .on(CHAT_MESSAGE.THREAD_ID.eq(CHAT_THREAD.ID))
            .where(CHAT_THREAD.ISSUE_ID.eq(ISSUE.ID))
            .and(CHAT_MESSAGE.DELETED_AT.isNull())
            .and(CHAT_MESSAGE.AUTHOR_ID.ne(uid))
            .andNotExists(
                selectOne()
                    .from(mine)
                    .where(mine.THREAD_ID.eq(CHAT_THREAD.ID))
                    .and(mine.AUTHOR_ID.eq(uid))
                    .and(mine.DELETED_AT.isNull())
                    .and(
                        row(mine.CREATED_AT, mine.ID)
                            .gt(row(CHAT_MESSAGE.CREATED_AT, CHAT_MESSAGE.ID)))));
  }

  /** 날짜 범위 필터의 하루 경계 기준 — AI 비서가 "이번 주"를 Asia/Seoul 로 계산하므로 같은 기준으로 자른다(WP-307). */
  private static final ZoneId FILTER_ZONE = ZoneId.of("Asia/Seoul");

  /**
   * 날짜 범위 조건 — 단일/횡단 검색 공용. 마감일(due_date)은 DATE 컬럼이라 그대로 비교하고, 종료일·생성일(WP-307)은 시각 컬럼이라 Asia/Seoul
   * 하루 경계로 해석해 양끝을 포함한다. 종료일 필터는 closed_at 이 없는(미종료) 이슈를 자연히 제외한다.
   */
  private Condition dateRangeCondition(IssueSearchQuery query) {
    Condition c = noCondition();
    if (query.dueFrom() != null) {
      c = c.and(ISSUE.DUE_DATE.ge(query.dueFrom()));
    }
    if (query.dueTo() != null) {
      c = c.and(ISSUE.DUE_DATE.le(query.dueTo()));
    }
    return c.and(seoulDayRange(ISSUE.CLOSED_AT, query.closedFrom(), query.closedTo()))
        .and(seoulDayRange(ISSUE.CREATED_AT, query.createdFrom(), query.createdTo()));
  }

  /** 시각 컬럼을 Asia/Seoul 날짜 범위(양끝 포함)로 자른다 — from 00:00 이상, to 다음 날 00:00 미만. null 쪽은 미적용. */
  private static Condition seoulDayRange(Field<OffsetDateTime> col, LocalDate from, LocalDate to) {
    Condition c = noCondition();
    if (from != null) {
      c = c.and(col.ge(from.atStartOfDay(FILTER_ZONE).toOffsetDateTime()));
    }
    if (to != null) {
      c = c.and(col.lt(to.plusDays(1).atStartOfDay(FILTER_ZONE).toOffsetDateTime()));
    }
    return c;
  }

  /**
   * 라벨 필터 조건 — 그룹 간 AND, 그룹 내 OR. 그룹마다 EXISTS 를 누적한다. 그룹 하나는 필터 토큰 하나에 대응하며, 이름 토큰은 횡단 조회에서 여러
   * 프로젝트의 동명 라벨 id 로 풀리므로 그 안은 OR 이어야 한다(#841). 단일/횡단 검색이 같은 의미를 갖도록 한 곳에 둔다.
   */
  private org.jooq.Condition labelGroupsCondition(List<List<Long>> groups) {
    org.jooq.Condition cond = org.jooq.impl.DSL.noCondition();
    if (groups == null) return cond;
    for (List<Long> group : groups) {
      cond =
          cond.and(
              org.jooq.impl.DSL.exists(
                  dsl.selectOne()
                      .from(com.workplace.jooq.Tables.ISSUE_LABEL)
                      .where(
                          com.workplace.jooq.Tables.ISSUE_LABEL
                              .ISSUE_ID
                              .eq(ISSUE.ID)
                              .and(com.workplace.jooq.Tables.ISSUE_LABEL.LABEL_ID.in(group)))));
    }
    return cond;
  }

  /**
   * 프로젝트 횡단 조회의 베이스 범위 — 활성 이슈 중 호출자가 멤버인 프로젝트의 이슈 + OPEN 프로젝트에 호출자가 올린 이슈, 삭제된 프로젝트 제외.
   * /me/issues({@link #searchMemberOf})와 AI 위임 작업 목록({@link AiTaskRepository})이 같은 접근 범위를 쓰도록 한 곳에
   * 둔다.
   */
  public Condition memberScopeCondition(Long memberUserId) {
    // 베이스 조건: 활성 이슈 + (멤버인 프로젝트 이슈 OR OPEN 프로젝트에 reporter 로 올린 이슈).
    // - 멤버십 EXISTS: 프로젝트 멤버라면 해당 프로젝트의 모든 이슈를 볼 수 있다.
    // - OPEN reporter OR: 비멤버라도 OPEN 프로젝트에 자신이 등록한 이슈는 홈에서 추적 가능해야 한다.
    org.jooq.Condition where =
        ISSUE
            .DELETED_AT
            .isNull()
            .and(
                org.jooq
                    .impl
                    .DSL
                    .exists(
                        dsl.selectOne()
                            .from(com.workplace.jooq.Tables.PROJECT_MEMBER)
                            .where(
                                com.workplace.jooq.Tables.PROJECT_MEMBER
                                    .PROJECT_ID
                                    .eq(ISSUE.PROJECT_ID)
                                    .and(
                                        com.workplace.jooq.Tables.PROJECT_MEMBER.USER_ID.eq(
                                            memberUserId))))
                    .or(
                        // OPEN 프로젝트의 reporter: 비멤버가 접수한 이슈를 자신의 홈에서 볼 수 있도록 허용.
                        ISSUE
                            .REPORTER_ID
                            .eq(memberUserId)
                            .and(
                                org.jooq.impl.DSL.exists(
                                    dsl.selectOne()
                                        .from(com.workplace.jooq.Tables.PROJECT)
                                        .where(
                                            com.workplace.jooq.Tables.PROJECT
                                                .ID
                                                .eq(ISSUE.PROJECT_ID)
                                                .and(
                                                    com.workplace.jooq.Tables.PROJECT.TYPE.eq(
                                                        "OPEN")))))));
    // 프로젝트 soft-delete 는 소속 이슈를 정리하지 않으므로, 삭제된 프로젝트의 이슈는 여기서 직접 제외한다.
    where =
        where.and(
            org.jooq.impl.DSL.exists(
                dsl.selectOne()
                    .from(com.workplace.jooq.Tables.PROJECT)
                    .where(
                        com.workplace.jooq.Tables.PROJECT
                            .ID
                            .eq(ISSUE.PROJECT_ID)
                            .and(com.workplace.jooq.Tables.PROJECT.DELETED_AT.isNull()))));
    return where;
  }

  /**
   * 프로젝트 횡단 검색 — 호출자가 멤버인 모든 프로젝트의 이슈를 필터/커서로 조회(홈 /me/issues). {@link #search(Long,
   * com.workplace.issue.dto.IssueSearchQuery)} 와 동일하되 베이스 스코프만 단일 프로젝트(PROJECT_ID.eq) 대신 멤버십 EXISTS
   * 로 교체한다. 추가로 OPEN 프로젝트에 이슈를 올린 비멤버 reporter 도 자신이 접수한 이슈를 "내 이슈"에서 볼 수 있도록 OR 조건을 확장한다.
   */
  public List<IssueRow> searchMemberOf(
      Long memberUserId, com.workplace.issue.dto.IssueSearchQuery query) {
    org.jooq.Condition where = memberOfFilterCondition(memberUserId, query);
    if (query.cursor() != null) {
      var ts = query.cursor().updatedAt().atOffset(java.time.ZoneOffset.UTC);
      var cursorId = query.cursor().id();
      // (updated_at, id) < (cursorTs, cursorId) — 동일 updated_at 인 경우 id 로 tie-break
      where =
          where.and(ISSUE.UPDATED_AT.lt(ts).or(ISSUE.UPDATED_AT.eq(ts).and(ISSUE.ID.lt(cursorId))));
    }

    return dsl.select(ROW_FIELDS)
        .from(ISSUE_WITH_STATUS)
        .where(where)
        .orderBy(ISSUE.UPDATED_AT.desc(), ISSUE.ID.desc())
        .limit(query.size())
        .fetch(this::mapToRow);
  }

  /**
   * 프로젝트 횡단 검색의 WHERE — 접근 범위({@link #memberScopeCondition}) AND 검색 필터. 커서 조건은 넣지 않는다: 기본
   * (updated_at, id) 커서는 {@link #searchMemberOf} 가, 프로젝트 묶음 정렬(WP-915)의 복합 커서는 {@link
   * MeIssueGroupedRepository} 가 각자 붙인다 — 두 경로가 같은 범위·필터를 쓰도록 한 곳에 둔다.
   */
  public Condition memberOfFilterCondition(
      Long memberUserId, com.workplace.issue.dto.IssueSearchQuery query) {
    org.jooq.Condition where = memberScopeCondition(memberUserId);

    if (query.q() != null && !query.q().isBlank()) {
      // 검색어의 %·_·\ 는 글자 그대로 찾는다(WP-471 — 그대로 넣으면 와일드카드가 돼 전체가 나왔다).
      String pattern = LikePatternUtils.containsPattern(query.q().trim());
      where =
          where.and(
              ISSUE
                  .TITLE
                  .likeIgnoreCase(pattern, '\\')
                  .or(ISSUE.BODY.likeIgnoreCase(pattern, '\\')));
    }
    if (query.statuses() != null && !query.statuses().isEmpty()) {
      where = where.and(ISSUE.STATUS.in(query.statuses()));
    }
    // WP-807 개별 상태 — 범주(statuses)와 AND, 상태 id 끼리는 OR.
    if (query.statusIds() != null && !query.statusIds().isEmpty()) {
      where = where.and(ISSUE.STATUS_ID.in(query.statusIds()));
    }
    if (query.priorities() != null && !query.priorities().isEmpty()) {
      where = where.and(ISSUE.PRIORITY.in(query.priorities()));
    }
    if (query.reporterIds() != null && !query.reporterIds().isEmpty()) {
      // reporter(이슈 생성자) 직접 컬럼 비교 — 횡단 "내가 만든"(/me/issues?reporter=me) 조회.
      where = where.and(ISSUE.REPORTER_ID.in(query.reporterIds()));
    }
    boolean hasAssigneeList = query.assigneeIds() != null && !query.assigneeIds().isEmpty();
    if (hasAssigneeList || query.includeUnassigned()) {
      // issue_assignee 매핑 기반 EXISTS/NOT EXISTS — 다중 담당자 구조에 맞춘 필터.
      org.jooq.Condition cond = org.jooq.impl.DSL.noCondition();
      if (hasAssigneeList) {
        cond =
            cond.or(
                org.jooq.impl.DSL.exists(
                    dsl.selectOne()
                        .from(com.workplace.jooq.Tables.ISSUE_ASSIGNEE)
                        .where(
                            com.workplace.jooq.Tables.ISSUE_ASSIGNEE
                                .ISSUE_ID
                                .eq(ISSUE.ID)
                                .and(
                                    com.workplace.jooq.Tables.ISSUE_ASSIGNEE.USER_ID.in(
                                        query.assigneeIds())))));
      }
      if (query.includeUnassigned()) {
        cond =
            cond.or(
                org.jooq.impl.DSL.notExists(
                    dsl.selectOne()
                        .from(com.workplace.jooq.Tables.ISSUE_ASSIGNEE)
                        .where(com.workplace.jooq.Tables.ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID))));
      }
      where = where.and(cond);
    }
    where = where.and(dateRangeCondition(query));
    where = where.and(watcherCondition(query));
    where = where.and(pendingForCondition(query));
    where = where.and(labelGroupsCondition(query.labelIdGroups()));
    where = where.and(cycleCondition(query));
    if (query.milestoneIds() != null && !query.milestoneIds().isEmpty()) {
      // 마일스톤은 issue.milestone_id 직접 컬럼 — OR 결합(IN), M:N 아니라 EXISTS 불필요
      where = where.and(ISSUE.MILESTONE_ID.in(query.milestoneIds()));
    }
    if (query.typeIds() != null && !query.typeIds().isEmpty()) {
      where = where.and(ISSUE.TYPE_ID.in(query.typeIds()));
    }
    // 횡단 경로에서는 parentNumber 로 프로젝트를 특정할 수 없어 지원하지 않는다(무시). topLevel 만 지원.
    if (Boolean.TRUE.equals(query.topLevel())) {
      where = where.and(ISSUE.PARENT_ISSUE_ID.isNull());
    }
    // blocked=true: 활성 차단자(미완료, 미삭제)가 존재하는 이슈만. 자기참조 회피를 위해 blocker self-alias 사용.
    // 대상 이슈 자신이 이미 DONE/CANCELED 면 차단자가 남아있어도 blocked=false 로 취급한다 (#826).
    if (Boolean.TRUE.equals(query.blocked())) {
      var blockerAlias = ISSUE.as("blocker");
      where =
          where
              .and(ISSUE.STATUS.notIn(IssueStatuses.CLOSED))
              .and(
                  org.jooq.impl.DSL.exists(
                      dsl.selectOne()
                          .from(com.workplace.jooq.Tables.ISSUE_DEPENDENCY)
                          .join(blockerAlias)
                          .on(
                              blockerAlias.ID.eq(
                                  com.workplace.jooq.Tables.ISSUE_DEPENDENCY.ISSUE_ID))
                          .where(
                              com.workplace.jooq.Tables.ISSUE_DEPENDENCY
                                  .BLOCKS_ISSUE_ID
                                  .eq(ISSUE.ID)
                                  .and(blockerAlias.STATUS.notIn(IssueStatuses.CLOSED))
                                  .and(blockerAlias.DELETED_AT.isNull()))));
    }
    // custom field 단일 동등 비교 필터 (fieldId+fieldValue 동시 지정 시). JSONB 를 텍스트로 캐스트하여 비교.
    if (query.fieldId() != null && query.fieldValue() != null) {
      where =
          where.and(
              org.jooq.impl.DSL.exists(
                  dsl.selectOne()
                      .from(com.workplace.jooq.Tables.ISSUE_FIELD_VALUE)
                      .where(
                          com.workplace.jooq.Tables.ISSUE_FIELD_VALUE
                              .ISSUE_ID
                              .eq(ISSUE.ID)
                              .and(
                                  com.workplace.jooq.Tables.ISSUE_FIELD_VALUE.FIELD_DEF_ID.eq(
                                      query.fieldId()))
                              .and(
                                  com.workplace.jooq.Tables.ISSUE_FIELD_VALUE
                                      .VALUE
                                      .cast(String.class)
                                      .eq(query.fieldValue())))));
    }
    return where;
  }

  /** soft-delete: deleted_at = 호출자 지정 timestamp. (Phase 4a — cascade 동일 timestamp 보장용 명시 인자) */
  public void softDelete(Long id, Instant deletedAt) {
    dsl.update(ISSUE)
        .set(ISSUE.DELETED_AT, deletedAt.atOffset(ZoneOffset.UTC))
        .where(ISSUE.ID.eq(id))
        .execute();
  }

  /** 부모 soft-delete 시 활성 자식들도 동일 timestamp 로 soft-delete. 이미 삭제된 자식은 건드리지 않는다. */
  public void softDeleteChildren(Long parentId, Instant deletedAt) {
    dsl.update(ISSUE)
        .set(ISSUE.DELETED_AT, deletedAt.atOffset(ZoneOffset.UTC))
        .where(ISSUE.PARENT_ISSUE_ID.eq(parentId).and(ISSUE.DELETED_AT.isNull()))
        .execute();
  }

  /** 부모의 활성(미삭제) 자식 이슈 id 목록 조회. softDeleteChildren 호출 전에 사용해 purge 대상 id 를 수집한다. */
  public List<Long> findActiveChildIds(Long parentId) {
    return dsl.select(ISSUE.ID)
        .from(ISSUE)
        .where(ISSUE.PARENT_ISSUE_ID.eq(parentId).and(ISSUE.DELETED_AT.isNull()))
        .fetch(ISSUE.ID);
  }

  /**
   * 부모의 활성 자식 중 미완료(DONE/CANCELED 가 아닌) 이슈 번호 목록 조회. EPIC → DONE 전이 차단 검증용(#710). 자식 유형과
   * 무관하게(SUBTASK 뿐 아니라 TASK 등 전체) 모두 집계한다 — 보드 카드의 SUBTASK 전용 진행률 표시와는 별개 기준.
   */
  public List<Integer> findIncompleteChildNumbers(Long parentId) {
    return dsl.select(ISSUE.NUMBER)
        .from(ISSUE)
        .where(
            ISSUE
                .PARENT_ISSUE_ID
                .eq(parentId)
                .and(ISSUE.DELETED_AT.isNull())
                .and(ISSUE.STATUS.notIn(IssueStatuses.CLOSED)))
        .orderBy(ISSUE.NUMBER)
        .fetch(ISSUE.NUMBER);
  }

  /**
   * 상태 삭제로 옮긴 이슈 한 건(WP-809).
   *
   * @param deleted 휴지통 이슈인가 — AI 작업 종료·에픽 재오픈은 활성 이슈만 대상
   */
  public record MigratedIssue(long id, boolean deleted, Long parentIssueId) {}

  /**
   * 한 상태의 이슈를 활성·휴지통 가리지 않고 모두 다른 상태로 옮긴다(상태 삭제, WP-809). status_id·status(범주)는 복합 FK 때문에 한 문장에서 함께
   * 바꾸고, closed_at 은 열림→종료면 now, 종료→열림이면 NULL, 그 밖에는 그대로 둔다. 사용자가 이슈를 고친 것이 아니라 설정 정리라
   * updated_at·version 은 건드리지 않는다(목록 정렬이 흔들리거나 편집 중인 화면이 거짓 충돌을 받지 않게).
   *
   * <p>열림·종료 판정은 행의 기존 status(범주)로 한다 — SET 의 오른쪽은 갱신 전 값을 보므로 범주를 따로 읽지 않아도 된다.
   */
  public List<MigratedIssue> migrateStatus(
      long projectId, long fromStatusId, long toStatusId, String toCategory) {
    Condition wasClosed = ISSUE.STATUS.in(IssueStatuses.CLOSED);
    Field<OffsetDateTime> closedAt =
        IssueStatuses.isClosed(toCategory)
            // 종료로: 열려 있던 행만 지금 시각, 이미 종료였던 행은 그대로
            ? DSL.when(wasClosed, ISSUE.CLOSED_AT).otherwise(DSL.currentOffsetDateTime())
            // 열림으로: 종료였던 행만 NULL, 열려 있던 행은 그대로
            : DSL.when(wasClosed, DSL.inline((OffsetDateTime) null)).otherwise(ISSUE.CLOSED_AT);
    return dsl.update(ISSUE)
        .set(ISSUE.STATUS_ID, toStatusId)
        .set(ISSUE.STATUS, toCategory)
        .set(ISSUE.CLOSED_AT, closedAt)
        .where(ISSUE.PROJECT_ID.eq(projectId).and(ISSUE.STATUS_ID.eq(fromStatusId)))
        .returning(ISSUE.ID, ISSUE.DELETED_AT, ISSUE.PARENT_ISSUE_ID)
        .fetch(
            r ->
                new MigratedIssue(
                    r.get(ISSUE.ID),
                    r.get(ISSUE.DELETED_AT) != null,
                    r.get(ISSUE.PARENT_ISSUE_ID)));
  }

  /** 한 상태의 활성(휴지통 제외) 이슈 수 — 상태 삭제 영향·옮길 상태 필수 판정(WP-809). */
  public int countActiveByStatus(long projectId, long statusId) {
    return dsl.fetchCount(
        ISSUE,
        ISSUE
            .PROJECT_ID
            .eq(projectId)
            .and(ISSUE.STATUS_ID.eq(statusId))
            .and(ISSUE.DELETED_AT.isNull()));
  }

  /**
   * 이 상태의 활성 에픽 중, 이 상태가 아닌 미완료(종료 범주가 아닌) 활성 하위가 있는 에픽 수(WP-809). 이 상태를 완료 범주로 옮기면 그 에픽들이 미완료 하위를
   * 둔 채 완료되므로 삭제를 막는 근거다. 같은 상태의 하위는 함께 옮겨져 같이 완료되므로 세지 않는다. 미완료 판정은 {@link
   * #findIncompleteChildNumbers} 와 같다(하위 유형 무관).
   */
  public int countEpicsWithIncompleteChildrenOutside(long projectId, long statusId) {
    var child = ISSUE.as("child");
    return dsl.fetchCount(
        dsl.select(ISSUE.ID)
            .from(ISSUE)
            .join(ISSUE_TYPE_DEF)
            .on(ISSUE_TYPE_DEF.ID.eq(ISSUE.TYPE_ID))
            .where(
                ISSUE
                    .PROJECT_ID
                    .eq(projectId)
                    .and(ISSUE.STATUS_ID.eq(statusId))
                    .and(ISSUE.DELETED_AT.isNull())
                    .and(ISSUE_TYPE_DEF.NAME.eq("EPIC"))
                    .and(
                        exists(
                            selectOne()
                                .from(child)
                                .where(
                                    child
                                        .PARENT_ISSUE_ID
                                        .eq(ISSUE.ID)
                                        .and(child.DELETED_AT.isNull())
                                        .and(child.STATUS.notIn(IssueStatuses.CLOSED))
                                        .and(child.STATUS_ID.ne(statusId)))))));
  }

  /**
   * 주어진 id 중 완료(DONE) 범주인 활성 에픽의 id → 지금 상태 이름(WP-809). 상태 삭제로 하위가 다시 열렸을 때 되돌릴 완료 에픽을 고르고, 그 이력의
   * 「이전 이름」을 남기는 데 쓴다. 빈 입력은 빈 맵.
   */
  public Map<Long, String> findDoneEpicStatusNames(Collection<Long> ids) {
    if (ids == null || ids.isEmpty()) return Map.of();
    Map<Long, String> out = new LinkedHashMap<>();
    dsl.select(ISSUE.ID, PROJECT_STATUS.NAME)
        .from(ISSUE)
        .join(ISSUE_TYPE_DEF)
        .on(ISSUE_TYPE_DEF.ID.eq(ISSUE.TYPE_ID))
        .join(PROJECT_STATUS)
        .on(PROJECT_STATUS.ID.eq(ISSUE.STATUS_ID))
        .where(
            ISSUE
                .ID
                .in(ids)
                .and(ISSUE.DELETED_AT.isNull())
                .and(ISSUE.STATUS.eq(IssueStatuses.DONE))
                .and(ISSUE_TYPE_DEF.NAME.eq("EPIC")))
        .orderBy(ISSUE.ID.asc())
        .forEach(r -> out.put(r.value1(), r.value2()));
    return out;
  }

  /**
   * 이슈들을 열린 범주 상태로 조용히 되돌린다 — closed_at 을 지우고 updated_at·version 은 그대로(상태 삭제의 완료 에픽 재오픈, WP-809).
   * 상태 삭제 이전과 같은 「설정 정리」라 {@link #migrateStatus} 와 같은 규칙을 따른다.
   */
  public void reopenQuietly(Collection<Long> ids, String category, long statusId) {
    if (ids == null || ids.isEmpty()) return;
    dsl.update(ISSUE)
        .set(ISSUE.STATUS_ID, statusId)
        .set(ISSUE.STATUS, category)
        .set(ISSUE.CLOSED_AT, (OffsetDateTime) null)
        .where(ISSUE.ID.in(ids))
        .execute();
  }

  /**
   * N+1 회피 — 자식 id 집합 → 부모 요약. self-alias 로 부모 row(번호·제목·상태)와 부모 type 을 함께 fetch. 부모가 없는 id 는 결과
   * 맵에서 제외된다.
   */
  public Map<Long, ParentRef> findParentRefsByIssueIds(List<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    var p = ISSUE.as("p");
    Map<Long, ParentRef> result = new HashMap<>();
    dsl.select(
            IssueStatusProjection.withFields(
                p,
                ISSUE.ID,
                p.NUMBER,
                p.TITLE,
                p.STATUS,
                ISSUE_TYPE_DEF.ID,
                ISSUE_TYPE_DEF.NAME,
                ISSUE_TYPE_DEF.COLOR_TOKEN,
                ISSUE_TYPE_DEF.ICON))
        // 부모의 사용자 정의 상태 이름·색(WP-869) — 별칭 p 기준 공용 LEFT JOIN(WP-937)
        .from(
            IssueStatusProjection.leftJoin(
                ISSUE
                    .join(p)
                    .on(p.ID.eq(ISSUE.PARENT_ISSUE_ID))
                    .join(ISSUE_TYPE_DEF)
                    .on(ISSUE_TYPE_DEF.ID.eq(p.TYPE_ID)),
                p))
        .where(ISSUE.ID.in(issueIds).and(ISSUE.PARENT_ISSUE_ID.isNotNull()))
        .fetch()
        .forEach(
            r ->
                result.put(
                    r.get(ISSUE.ID),
                    new ParentRef(
                        r.get(p.NUMBER),
                        r.get(p.TITLE),
                        new IssueTypeSummary(
                            r.get(ISSUE_TYPE_DEF.ID),
                            r.get(ISSUE_TYPE_DEF.NAME),
                            r.get(ISSUE_TYPE_DEF.COLOR_TOKEN),
                            r.get(ISSUE_TYPE_DEF.ICON)),
                        // 부모 상태 — 부모 행이 응답에 없어도 하위만으로 부모 취소 여부를 판단하게(WP-247)
                        r.get(p.STATUS),
                        r.get(p.STATUS_ID),
                        r.get(STATUS_NAME),
                        r.get(STATUS_COLOR))));
    return result;
  }

  /** 부모 id 집합 → 활성 자식 수 맵. 입력에 들어온 모든 id 에 대해 0 으로 초기화 후 group by 결과로 덮어쓴다. */
  public Map<Long, Integer> countChildrenByParentIds(List<Long> parentIds) {
    if (parentIds == null || parentIds.isEmpty()) return Map.of();
    Map<Long, Integer> result = new HashMap<>();
    for (Long id : parentIds) result.put(id, 0);
    dsl.select(ISSUE.PARENT_ISSUE_ID, count())
        .from(ISSUE)
        .where(ISSUE.PARENT_ISSUE_ID.in(parentIds).and(ISSUE.DELETED_AT.isNull()))
        .groupBy(ISSUE.PARENT_ISSUE_ID)
        .fetch()
        .forEach(r -> result.put(r.value1(), r.value2()));
    return result;
  }

  /** 부모 id 집합 → 활성 + 종료({@link IssueStatuses#CLOSED}) 자식 수 맵. 진행률 표시용 — 취소도 완료로 집계(WP-243). */
  public Map<Long, Integer> countDoneChildrenByParentIds(List<Long> parentIds) {
    if (parentIds == null || parentIds.isEmpty()) return Map.of();
    Map<Long, Integer> result = new HashMap<>();
    for (Long id : parentIds) result.put(id, 0);
    dsl.select(ISSUE.PARENT_ISSUE_ID, count())
        .from(ISSUE)
        .where(
            ISSUE
                .PARENT_ISSUE_ID
                .in(parentIds)
                .and(ISSUE.DELETED_AT.isNull())
                .and(ISSUE.STATUS.in(IssueStatuses.CLOSED)))
        .groupBy(ISSUE.PARENT_ISSUE_ID)
        .fetch()
        .forEach(r -> result.put(r.value1(), r.value2()));
    return result;
  }

  /**
   * 구독 목록(/me/watched-issues)의 범위 — 호출자가 구독한(issue_watcher) 활성 이슈 중 활성 프로젝트이면서 공개 접수함(OPEN)이거나 호출자가
   * 현재 멤버인 프로젝트의 것. OPEN 은 비멤버도 구독할 수 있어(WP-631) 함께 보이고, 멤버에서 빠진 TEAM 프로젝트 이슈는 숨는다. 프로젝트
   * soft-delete 는 소속 이슈/watcher 를 정리하지 않으므로 삭제된 프로젝트는 여기서 직접 제외한다(#623 후속). 기본 (updated_at, id)
   * 경로({@link #findReadableWatchedBy})와 프로젝트 묶음 정렬(WP-915, {@link MeIssueGroupedRepository})이 같은
   * 범위를 쓰도록 한 곳에 둔다.
   */
  public Condition watchedReadableCondition(Long watcherUserId) {
    var project = com.workplace.jooq.Tables.PROJECT;
    var member = com.workplace.jooq.Tables.PROJECT_MEMBER;
    var watcher = com.workplace.jooq.Tables.ISSUE_WATCHER;
    return org.jooq
        .impl
        .DSL
        .exists(
            dsl.selectOne()
                .from(watcher)
                .where(watcher.ISSUE_ID.eq(ISSUE.ID))
                .and(watcher.USER_ID.eq(watcherUserId)))
        .and(ISSUE.DELETED_AT.isNull())
        .and(
            org.jooq.impl.DSL.exists(
                dsl.selectOne()
                    .from(project)
                    .where(project.ID.eq(ISSUE.PROJECT_ID))
                    .and(project.DELETED_AT.isNull())
                    .and(
                        project
                            .TYPE
                            .eq("OPEN")
                            .or(
                                org.jooq.impl.DSL.exists(
                                    dsl.selectOne()
                                        .from(member)
                                        .where(member.PROJECT_ID.eq(ISSUE.PROJECT_ID))
                                        .and(member.USER_ID.eq(watcherUserId)))))));
  }

  /** 구독 목록 기본 경로 — {@link #watchedReadableCondition} 범위를 (updated_at, id) DESC cursor 로 페이징한다. */
  public List<IssueRow> findReadableWatchedBy(
      Long watcherUserId, com.workplace.issue.dto.IssueCursor cursor, int size) {
    Condition where = watchedReadableCondition(watcherUserId);
    if (cursor != null) {
      var ts = cursor.updatedAt().atOffset(java.time.ZoneOffset.UTC);
      var cursorId = cursor.id();
      where =
          where.and(ISSUE.UPDATED_AT.lt(ts).or(ISSUE.UPDATED_AT.eq(ts).and(ISSUE.ID.lt(cursorId))));
    }
    return dsl.select(ROW_FIELDS)
        .from(ISSUE_WITH_STATUS)
        .where(where)
        .orderBy(ISSUE.UPDATED_AT.desc(), ISSUE.ID.desc())
        .limit(size)
        .fetch(this::mapToRow);
  }

  /**
   * 전역 issue.id 목록 중 호출자가 멤버인 프로젝트의 활성 이슈만 경량 참조로 배치 조회한다. wiki 멘션 하이드레이션용 — 가시성은 PROJECT_MEMBER
   * 멤버십 EXISTS 로 스코핑(비슷한 패턴이 {@link #watchedReadableCondition}), 삭제된 프로젝트의 이슈 제외. PROJECT 조인으로
   * projectKey/number/title 을 함께 반환한다. 빈 ids 면 빈 리스트.
   */
  public List<com.workplace.issue.dto.IssueRef> findVisibleRefsByIds(
      long callerId, List<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return List.of();
    return dsl.select(ISSUE.ID, com.workplace.jooq.Tables.PROJECT.KEY, ISSUE.NUMBER, ISSUE.TITLE)
        .from(ISSUE)
        .join(com.workplace.jooq.Tables.PROJECT)
        .on(com.workplace.jooq.Tables.PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(ISSUE.ID.in(issueIds))
        .and(ISSUE.DELETED_AT.isNull())
        // 프로젝트 soft-delete 는 소속 이슈를 정리하지 않는다 — 삭제된 프로젝트의 이슈는 삭제된 이슈처럼 숨긴다(WP-786).
        .and(com.workplace.jooq.Tables.PROJECT.DELETED_AT.isNull())
        .and(
            org.jooq.impl.DSL.exists(
                dsl.selectOne()
                    .from(com.workplace.jooq.Tables.PROJECT_MEMBER)
                    .where(
                        com.workplace.jooq.Tables.PROJECT_MEMBER
                            .PROJECT_ID
                            .eq(ISSUE.PROJECT_ID)
                            .and(com.workplace.jooq.Tables.PROJECT_MEMBER.USER_ID.eq(callerId)))))
        .fetch(
            r ->
                new com.workplace.issue.dto.IssueRef(
                    r.get(ISSUE.ID),
                    r.get(com.workplace.jooq.Tables.PROJECT.KEY),
                    r.get(ISSUE.NUMBER),
                    r.get(ISSUE.TITLE)));
  }

  /**
   * 여러 프로젝트의 상태별 이슈 개수를 한 쿼리로 집계한다(N+1 회피). 삭제된 이슈(deleted_at IS NOT NULL) 제외.
   *
   * @return projectId → (status → count)
   */
  public Map<Long, Map<String, Integer>> countByStatusForProjects(List<Long> projectIds) {
    Map<Long, Map<String, Integer>> result = new LinkedHashMap<>();
    if (projectIds.isEmpty()) return result;
    dsl.select(ISSUE.PROJECT_ID, ISSUE.STATUS, count())
        .from(ISSUE)
        .where(ISSUE.PROJECT_ID.in(projectIds).and(ISSUE.DELETED_AT.isNull()))
        .groupBy(ISSUE.PROJECT_ID, ISSUE.STATUS)
        .fetch()
        .forEach(
            r ->
                result
                    .computeIfAbsent(r.get(ISSUE.PROJECT_ID), k -> new LinkedHashMap<>())
                    .put(r.get(ISSUE.STATUS), r.get(count())));
    return result;
  }

  /** #520 이슈 출처(cross-app source) 백레퍼런스 갱신. source_type/source_id 는 nullable. */
  public void updateSource(long issueId, String sourceType, Long sourceId) {
    dsl.update(ISSUE)
        .set(ISSUE.SOURCE_TYPE, sourceType)
        .set(ISSUE.SOURCE_ID, sourceId)
        .where(ISSUE.ID.eq(issueId))
        .execute();
  }

  /**
   * 출처로 연결된 이슈 중 호출자가 멤버인 프로젝트의 활성 이슈 최신 1건(key·title·status). 가시성은 {@link #findVisibleRefsByIds} 와
   * 같은 PROJECT_MEMBER 멤버십 EXISTS — 프로젝트에서 빠진 사용자에게 제목·상태를 새지 않게 한다. 테넌트 RLS 안의 이슈만 보인다.
   */
  public Optional<com.workplace.issue.dto.SourceIssueRef> findVisibleSourceIssue(
      long callerId, String sourceType, long sourceId) {
    return dsl.select(PROJECT.KEY, ISSUE.NUMBER, ISSUE.TITLE, ISSUE.STATUS, STATUS_NAME)
        // 상태 이름(WP-869)도 함께 — 메일 AI 가 범주 코드 대신 「검토 중」 같은 이름을 쓰게
        .from(ISSUE_WITH_STATUS)
        .join(PROJECT)
        .on(ISSUE.PROJECT_ID.eq(PROJECT.ID))
        .where(ISSUE.SOURCE_TYPE.eq(sourceType))
        .and(ISSUE.SOURCE_ID.eq(sourceId))
        .and(ISSUE.DELETED_AT.isNull())
        .and(PROJECT.DELETED_AT.isNull()) // 삭제된 프로젝트의 이슈는 숨긴다(WP-786)
        .and(
            org.jooq.impl.DSL.exists(
                dsl.selectOne()
                    .from(com.workplace.jooq.Tables.PROJECT_MEMBER)
                    .where(
                        com.workplace.jooq.Tables.PROJECT_MEMBER
                            .PROJECT_ID
                            .eq(ISSUE.PROJECT_ID)
                            .and(com.workplace.jooq.Tables.PROJECT_MEMBER.USER_ID.eq(callerId)))))
        .orderBy(ISSUE.ID.desc())
        .limit(1)
        .fetchOptional(
            r ->
                new com.workplace.issue.dto.SourceIssueRef(
                    r.value1() + "-" + r.value2(), r.value3(), r.value4(), r.value5()));
  }

  /** #520 출처로 연결된 이슈 키 조회(메일 배지용). 반환값은 "{projectKey}-{number}". 테넌트 RLS 내에서만 보이는 이슈로 한정된다. */
  public Optional<String> findSourceIssueKey(String sourceType, long sourceId) {
    return dsl.select(PROJECT.KEY, ISSUE.NUMBER)
        .from(ISSUE)
        .join(PROJECT)
        .on(ISSUE.PROJECT_ID.eq(PROJECT.ID))
        .where(ISSUE.SOURCE_TYPE.eq(sourceType))
        .and(ISSUE.SOURCE_ID.eq(sourceId))
        .and(ISSUE.DELETED_AT.isNull())
        .and(PROJECT.DELETED_AT.isNull()) // 삭제된 프로젝트의 이슈는 숨긴다(WP-786)
        .orderBy(ISSUE.ID.desc())
        .limit(1)
        .fetchOptional()
        .map(r -> r.value1() + "-" + r.value2());
  }
}
