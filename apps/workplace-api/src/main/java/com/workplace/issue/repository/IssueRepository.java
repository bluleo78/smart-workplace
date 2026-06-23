package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static org.jooq.impl.DSL.count;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueTypeSummary;
import com.workplace.issue.dto.ParentRef;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/** issue 테이블 jOOQ 리포지토리. 모든 조회는 soft-delete(deleted_at IS NULL) 기준 활성 row 만 대상. */
@Repository
@RequiredArgsConstructor
public class IssueRepository {

  private final DSLContext dsl;

  /**
   * SELECT 결과를 {@link IssueRow} 로 매핑. OffsetDateTime → Instant 변환. typeId 는 V10 이후 NOT NULL,
   * parentIssueId 는 V11 이후 nullable.
   */
  private IssueRow mapToRow(Record r) {
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
        r.get(ISSUE.PARENT_ISSUE_ID));
  }

  /** id 로 활성 이슈 조회. */
  public Optional<IssueRow> findById(Long id) {
    return dsl.select(
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
            ISSUE.PARENT_ISSUE_ID)
        .from(ISSUE)
        .where(ISSUE.ID.eq(id).and(ISSUE.DELETED_AT.isNull()))
        .fetchOptional(this::mapToRow);
  }

  /** projectId + number 로 활성 이슈 조회. */
  public Optional<IssueRow> findByProjectAndNumber(Long projectId, int number) {
    return dsl.select(
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
            ISSUE.PARENT_ISSUE_ID)
        .from(ISSUE)
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
    return dsl.select(
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
            ISSUE.PARENT_ISSUE_ID)
        .from(ISSUE)
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
   * 신규 이슈 INSERT 후 생성된 row 반환. status 는 DB default('TODO') 사용. 담당자는 별도 매핑(issue_assignee) 으로 관리.
   * typeId 는 V10 이후 NOT NULL — 호출자가 결정(typically TASK fallback) 해서 전달. parentIssueId 는 SUBTASK 일 때만
   * non-null (Phase 4a) — 부모-자식 정합성은 서비스 계층에서 가드.
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
      Long parentIssueId) {
    return dsl.insertInto(ISSUE)
        .set(ISSUE.PROJECT_ID, projectId)
        .set(ISSUE.NUMBER, number)
        .set(ISSUE.TITLE, title)
        .set(ISSUE.BODY, body)
        .set(ISSUE.PRIORITY, priority)
        .set(ISSUE.DUE_DATE, dueDate)
        .set(ISSUE.REPORTER_ID, reporterId)
        .set(ISSUE.TYPE_ID, typeId)
        .set(ISSUE.PARENT_ISSUE_ID, parentIssueId)
        .returning(
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
            ISSUE.PARENT_ISSUE_ID)
        .fetchOptional()
        .map(this::mapToRow)
        .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
  }

  /** 8-인자 호환 오버로드 — Phase 27 도입. parentIssueId 는 null 로 위임. 비SUBTASK 이슈 시드용 서비스 경로에서 사용. */
  public IssueRow insert(
      Long projectId,
      int number,
      String title,
      String body,
      String priority,
      LocalDate dueDate,
      Long reporterId,
      Long typeId) {
    return insert(projectId, number, title, body, priority, dueDate, reporterId, typeId, null);
  }

  /**
   * 테스트 편의 오버로드 — typeId 미지정 시 프로젝트의 TASK 시스템 유형으로 자동 fallback. 프로덕션 서비스 코드는 8/9-인자 변형을 직접 호출. 이
   * 오버로드는 신규 type 컬럼 추가 후 다수 테스트 시드의 마이그레이션 비용을 줄이기 위한 호환층.
   */
  public IssueRow insert(
      Long projectId,
      int number,
      String title,
      String body,
      String priority,
      LocalDate dueDate,
      Long reporterId) {
    Long taskTypeId =
        dsl.select(ISSUE_TYPE_DEF.ID)
            .from(ISSUE_TYPE_DEF)
            .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(projectId).and(ISSUE_TYPE_DEF.NAME.eq("TASK")))
            .fetchOptional(ISSUE_TYPE_DEF.ID)
            .orElseThrow(
                () -> new IllegalStateException("프로젝트에 TASK 유형이 없음: projectId=" + projectId));
    return insert(projectId, number, title, body, priority, dueDate, reporterId, taskTypeId, null);
  }

  /**
   * 모든 변경 가능 필드 일괄 갱신. updated_at = now(). closedAt 은 호출자가 계산하여 전달. type 변경은 별도 {@link
   * #updateType}.
   */
  public void updateAll(
      Long id,
      String title,
      String body,
      String status,
      String priority,
      LocalDate dueDate,
      java.time.Instant closedAt) {
    dsl.update(ISSUE)
        .set(ISSUE.TITLE, title)
        .set(ISSUE.BODY, body)
        .set(ISSUE.STATUS, status)
        .set(ISSUE.PRIORITY, priority)
        .set(ISSUE.DUE_DATE, dueDate)
        .set(ISSUE.CLOSED_AT, closedAt != null ? closedAt.atOffset(java.time.ZoneOffset.UTC) : null)
        .set(ISSUE.UPDATED_AT, OffsetDateTime.now())
        .where(ISSUE.ID.eq(id))
        .execute();
  }

  /** 유형만 갱신 — updated_at 동기. 서비스에서 fast-return / history 기록과 함께 사용. */
  public void updateType(Long id, Long newTypeId) {
    dsl.update(ISSUE)
        .set(ISSUE.TYPE_ID, newTypeId)
        .set(ISSUE.UPDATED_AT, OffsetDateTime.now())
        .where(ISSUE.ID.eq(id))
        .execute();
  }

  /** 부모(SUBTASK) 갱신 — newParentId null 이면 해제. updated_at 동기. (Phase 4a) */
  public void updateParent(Long id, Long newParentId) {
    dsl.update(ISSUE)
        .set(ISSUE.PARENT_ISSUE_ID, newParentId)
        .set(ISSUE.UPDATED_AT, OffsetDateTime.now())
        .where(ISSUE.ID.eq(id))
        .execute();
  }

  /**
   * 검색/필터 + cursor 페이징. 활성(deleted_at IS NULL) 이슈만 대상. 정렬은 (updated_at DESC, id DESC) 고정. size 는
   * 호출자가 1..100 으로 클램프한 값을 넘긴다. assignee 필터는 issue_assignee 매핑에 대한 EXISTS/NOT EXISTS 로 변환된다.
   * typeIds 는 OR 결합. Phase 4a: parentNumber/topLevel 필터.
   */
  public List<IssueRow> search(Long projectId, com.workplace.issue.dto.IssueSearchQuery query) {
    org.jooq.Condition where = ISSUE.PROJECT_ID.eq(projectId).and(ISSUE.DELETED_AT.isNull());

    if (query.q() != null && !query.q().isBlank()) {
      String pattern = "%" + query.q().trim() + "%";
      where = where.and(ISSUE.TITLE.likeIgnoreCase(pattern).or(ISSUE.BODY.likeIgnoreCase(pattern)));
    }
    if (query.statuses() != null && !query.statuses().isEmpty()) {
      where = where.and(ISSUE.STATUS.in(query.statuses()));
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
    if (query.dueFrom() != null) {
      where = where.and(ISSUE.DUE_DATE.ge(query.dueFrom()));
    }
    if (query.dueTo() != null) {
      where = where.and(ISSUE.DUE_DATE.le(query.dueTo()));
    }
    if (query.labelIds() != null && !query.labelIds().isEmpty()) {
      // 라벨은 AND 결합 — 모든 ID 가 부착된 이슈만 매칭 (EXISTS 서브쿼리를 ID 별로 누적)
      for (Long lid : query.labelIds()) {
        where =
            where.and(
                org.jooq.impl.DSL.exists(
                    dsl.selectOne()
                        .from(com.workplace.jooq.Tables.ISSUE_LABEL)
                        .where(
                            com.workplace.jooq.Tables.ISSUE_LABEL
                                .ISSUE_ID
                                .eq(ISSUE.ID)
                                .and(com.workplace.jooq.Tables.ISSUE_LABEL.LABEL_ID.eq(lid)))));
      }
    }
    if (query.cycleIds() != null && !query.cycleIds().isEmpty()) {
      // 사이클은 OR 결합 — 지정된 사이클 중 하나라도 연결된 이슈만 매칭 (IN 을 포함한 단일 EXISTS)
      where =
          where.and(
              org.jooq.impl.DSL.exists(
                  dsl.selectOne()
                      .from(com.workplace.jooq.Tables.ISSUE_CYCLE)
                      .where(
                          com.workplace.jooq.Tables.ISSUE_CYCLE
                              .ISSUE_ID
                              .eq(ISSUE.ID)
                              .and(
                                  com.workplace.jooq.Tables.ISSUE_CYCLE.CYCLE_ID.in(
                                      query.cycleIds())))));
    }
    if (query.typeIds() != null && !query.typeIds().isEmpty()) {
      where = where.and(ISSUE.TYPE_ID.in(query.typeIds()));
    }
    // Phase 4a — parentNumber 가 지정되면 해당 부모의 자식만, 아니면 topLevel=true 면 루트만.
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
    } else if (Boolean.TRUE.equals(query.topLevel())) {
      where = where.and(ISSUE.PARENT_ISSUE_ID.isNull());
    }
    // Phase 4b — blocked=true: 활성 차단자(미완료, 미삭제)가 존재하는 이슈만. 자기참조 회피를 위해 blocker self-alias 사용.
    if (Boolean.TRUE.equals(query.blocked())) {
      var blockerAlias = ISSUE.as("blocker");
      where =
          where.and(
              org.jooq.impl.DSL.exists(
                  dsl.selectOne()
                      .from(com.workplace.jooq.Tables.ISSUE_DEPENDENCY)
                      .join(blockerAlias)
                      .on(blockerAlias.ID.eq(com.workplace.jooq.Tables.ISSUE_DEPENDENCY.ISSUE_ID))
                      .where(
                          com.workplace.jooq.Tables.ISSUE_DEPENDENCY
                              .BLOCKS_ISSUE_ID
                              .eq(ISSUE.ID)
                              .and(blockerAlias.STATUS.notIn("DONE", "CANCELED"))
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
    if (query.cursor() != null) {
      var ts = query.cursor().updatedAt().atOffset(java.time.ZoneOffset.UTC);
      var cursorId = query.cursor().id();
      // (updated_at, id) < (cursorTs, cursorId) — 동일 updated_at 인 경우 id 로 tie-break
      where =
          where.and(ISSUE.UPDATED_AT.lt(ts).or(ISSUE.UPDATED_AT.eq(ts).and(ISSUE.ID.lt(cursorId))));
    }

    return dsl.select(
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
            ISSUE.PARENT_ISSUE_ID)
        .from(ISSUE)
        .where(where)
        .orderBy(ISSUE.UPDATED_AT.desc(), ISSUE.ID.desc())
        .limit(query.size())
        .fetch(this::mapToRow);
  }

  /**
   * 프로젝트 횡단 검색 — 호출자가 멤버인 모든 프로젝트의 이슈를 필터/커서로 조회(홈 /me/issues). {@link #search(Long,
   * com.workplace.issue.dto.IssueSearchQuery)} 와 동일하되 베이스 스코프만 단일 프로젝트(PROJECT_ID.eq) 대신 멤버십 EXISTS
   * 로 교체한다(비멤버 프로젝트 이슈는 누락). 나머지 필터/정렬/페이징은 동일.
   */
  public List<IssueRow> searchMemberOf(
      Long memberUserId, com.workplace.issue.dto.IssueSearchQuery query) {
    // 베이스 조건: 활성 이슈 + 호출자가 멤버인 프로젝트(findByIdsActiveMemberOf 의 멤버십 EXISTS 패턴 미러).
    org.jooq.Condition where =
        ISSUE
            .DELETED_AT
            .isNull()
            .and(
                org.jooq.impl.DSL.exists(
                    dsl.selectOne()
                        .from(com.workplace.jooq.Tables.PROJECT_MEMBER)
                        .where(
                            com.workplace.jooq.Tables.PROJECT_MEMBER
                                .PROJECT_ID
                                .eq(ISSUE.PROJECT_ID)
                                .and(
                                    com.workplace.jooq.Tables.PROJECT_MEMBER.USER_ID.eq(
                                        memberUserId)))));

    if (query.q() != null && !query.q().isBlank()) {
      String pattern = "%" + query.q().trim() + "%";
      where = where.and(ISSUE.TITLE.likeIgnoreCase(pattern).or(ISSUE.BODY.likeIgnoreCase(pattern)));
    }
    if (query.statuses() != null && !query.statuses().isEmpty()) {
      where = where.and(ISSUE.STATUS.in(query.statuses()));
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
    if (query.dueFrom() != null) {
      where = where.and(ISSUE.DUE_DATE.ge(query.dueFrom()));
    }
    if (query.dueTo() != null) {
      where = where.and(ISSUE.DUE_DATE.le(query.dueTo()));
    }
    if (query.labelIds() != null && !query.labelIds().isEmpty()) {
      // 라벨은 AND 결합 — 모든 ID 가 부착된 이슈만 매칭 (EXISTS 서브쿼리를 ID 별로 누적)
      for (Long lid : query.labelIds()) {
        where =
            where.and(
                org.jooq.impl.DSL.exists(
                    dsl.selectOne()
                        .from(com.workplace.jooq.Tables.ISSUE_LABEL)
                        .where(
                            com.workplace.jooq.Tables.ISSUE_LABEL
                                .ISSUE_ID
                                .eq(ISSUE.ID)
                                .and(com.workplace.jooq.Tables.ISSUE_LABEL.LABEL_ID.eq(lid)))));
      }
    }
    if (query.cycleIds() != null && !query.cycleIds().isEmpty()) {
      // 사이클은 OR 결합 — 지정된 사이클 중 하나라도 연결된 이슈만 매칭 (IN 을 포함한 단일 EXISTS)
      where =
          where.and(
              org.jooq.impl.DSL.exists(
                  dsl.selectOne()
                      .from(com.workplace.jooq.Tables.ISSUE_CYCLE)
                      .where(
                          com.workplace.jooq.Tables.ISSUE_CYCLE
                              .ISSUE_ID
                              .eq(ISSUE.ID)
                              .and(
                                  com.workplace.jooq.Tables.ISSUE_CYCLE.CYCLE_ID.in(
                                      query.cycleIds())))));
    }
    if (query.typeIds() != null && !query.typeIds().isEmpty()) {
      where = where.and(ISSUE.TYPE_ID.in(query.typeIds()));
    }
    // 횡단 경로에서는 parentNumber 로 프로젝트를 특정할 수 없어 지원하지 않는다(무시). topLevel 만 지원.
    if (Boolean.TRUE.equals(query.topLevel())) {
      where = where.and(ISSUE.PARENT_ISSUE_ID.isNull());
    }
    // blocked=true: 활성 차단자(미완료, 미삭제)가 존재하는 이슈만. 자기참조 회피를 위해 blocker self-alias 사용.
    if (Boolean.TRUE.equals(query.blocked())) {
      var blockerAlias = ISSUE.as("blocker");
      where =
          where.and(
              org.jooq.impl.DSL.exists(
                  dsl.selectOne()
                      .from(com.workplace.jooq.Tables.ISSUE_DEPENDENCY)
                      .join(blockerAlias)
                      .on(blockerAlias.ID.eq(com.workplace.jooq.Tables.ISSUE_DEPENDENCY.ISSUE_ID))
                      .where(
                          com.workplace.jooq.Tables.ISSUE_DEPENDENCY
                              .BLOCKS_ISSUE_ID
                              .eq(ISSUE.ID)
                              .and(blockerAlias.STATUS.notIn("DONE", "CANCELED"))
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
    if (query.cursor() != null) {
      var ts = query.cursor().updatedAt().atOffset(java.time.ZoneOffset.UTC);
      var cursorId = query.cursor().id();
      // (updated_at, id) < (cursorTs, cursorId) — 동일 updated_at 인 경우 id 로 tie-break
      where =
          where.and(ISSUE.UPDATED_AT.lt(ts).or(ISSUE.UPDATED_AT.eq(ts).and(ISSUE.ID.lt(cursorId))));
    }

    return dsl.select(
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
            ISSUE.PARENT_ISSUE_ID)
        .from(ISSUE)
        .where(where)
        .orderBy(ISSUE.UPDATED_AT.desc(), ISSUE.ID.desc())
        .limit(query.size())
        .fetch(this::mapToRow);
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
   * N+1 회피 — 자식 id 집합 → 부모 요약. self-alias 로 부모 row 와 부모 type 을 함께 fetch. 부모가 없는 id 는 결과 맵에서 제외된다.
   */
  public Map<Long, ParentRef> findParentRefsByIssueIds(List<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    var p = ISSUE.as("p");
    Map<Long, ParentRef> result = new HashMap<>();
    dsl.select(
            ISSUE.ID,
            p.NUMBER,
            p.TITLE,
            ISSUE_TYPE_DEF.ID,
            ISSUE_TYPE_DEF.NAME,
            ISSUE_TYPE_DEF.COLOR_TOKEN,
            ISSUE_TYPE_DEF.ICON)
        .from(ISSUE)
        .join(p)
        .on(p.ID.eq(ISSUE.PARENT_ISSUE_ID))
        .join(ISSUE_TYPE_DEF)
        .on(ISSUE_TYPE_DEF.ID.eq(p.TYPE_ID))
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
                            r.get(ISSUE_TYPE_DEF.ICON)))));
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

  /** 부모 id 집합 → 활성 + status=DONE 자식 수 맵. 진행률 표시용. */
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
                .and(ISSUE.STATUS.eq("DONE")))
        .groupBy(ISSUE.PARENT_ISSUE_ID)
        .fetch()
        .forEach(r -> result.put(r.value1(), r.value2()));
    return result;
  }

  /** watched-issues 전용 헬퍼. 호출자가 현재 멤버인 프로젝트의 활성 이슈만, ids 제한 + (updated_at, id) DESC cursor 페이징. */
  public List<IssueRow> findByIdsActiveMemberOf(
      List<Long> issueIds,
      Long memberUserId,
      com.workplace.issue.dto.IssueCursor cursor,
      int size) {
    if (issueIds == null || issueIds.isEmpty()) return List.of();
    org.jooq.Condition where = ISSUE.ID.in(issueIds).and(ISSUE.DELETED_AT.isNull());
    where =
        where.and(
            org.jooq.impl.DSL.exists(
                dsl.selectOne()
                    .from(com.workplace.jooq.Tables.PROJECT_MEMBER)
                    .where(
                        com.workplace.jooq.Tables.PROJECT_MEMBER
                            .PROJECT_ID
                            .eq(ISSUE.PROJECT_ID)
                            .and(
                                com.workplace.jooq.Tables.PROJECT_MEMBER.USER_ID.eq(
                                    memberUserId)))));
    if (cursor != null) {
      var ts = cursor.updatedAt().atOffset(java.time.ZoneOffset.UTC);
      var cursorId = cursor.id();
      where =
          where.and(ISSUE.UPDATED_AT.lt(ts).or(ISSUE.UPDATED_AT.eq(ts).and(ISSUE.ID.lt(cursorId))));
    }
    return dsl.select(
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
            ISSUE.PARENT_ISSUE_ID)
        .from(ISSUE)
        .where(where)
        .orderBy(ISSUE.UPDATED_AT.desc(), ISSUE.ID.desc())
        .limit(size)
        .fetch(this::mapToRow);
  }

  /**
   * 전역 issue.id 목록 중 호출자가 멤버인 프로젝트의 활성 이슈만 경량 참조로 배치 조회한다. wiki 멘션 하이드레이션용 — 가시성은 PROJECT_MEMBER
   * 멤버십 EXISTS 로 스코핑(같은 패턴이 {@link #findByIdsActiveMemberOf}). PROJECT 조인으로 projectKey/number/title
   * 을 함께 반환한다. 빈 ids 면 빈 리스트.
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
}
