package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static org.jooq.impl.DSL.count;

import com.workplace.issue.dto.IssueRow;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
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

  /** SELECT 결과를 {@link IssueRow} 로 매핑. OffsetDateTime → Instant 변환. typeId 는 V10 이후 NOT NULL. */
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
        r.get(ISSUE.TYPE_ID));
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
            ISSUE.TYPE_ID)
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
            ISSUE.TYPE_ID)
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
            ISSUE.TYPE_ID)
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
   * typeId 는 V10 이후 NOT NULL — 호출자가 결정(typically TASK fallback) 해서 전달.
   */
  public IssueRow insert(
      Long projectId,
      int number,
      String title,
      String body,
      String priority,
      LocalDate dueDate,
      Long reporterId,
      Long typeId) {
    return dsl.insertInto(ISSUE)
        .set(ISSUE.PROJECT_ID, projectId)
        .set(ISSUE.NUMBER, number)
        .set(ISSUE.TITLE, title)
        .set(ISSUE.BODY, body)
        .set(ISSUE.PRIORITY, priority)
        .set(ISSUE.DUE_DATE, dueDate)
        .set(ISSUE.REPORTER_ID, reporterId)
        .set(ISSUE.TYPE_ID, typeId)
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
            ISSUE.TYPE_ID)
        .fetchOptional()
        .map(this::mapToRow)
        .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
  }

  /**
   * 테스트 편의 오버로드 — typeId 미지정 시 프로젝트의 TASK 시스템 유형으로 자동 fallback. 프로덕션 서비스 코드는 8-인자 변형을 직접 호출(typeId
   * 를 명시적으로 결정해서 전달)한다. 이 오버로드는 신규 type 컬럼 추가 후 다수 테스트 시드의 마이그레이션 비용을 줄이기 위한 호환층.
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
    return insert(projectId, number, title, body, priority, dueDate, reporterId, taskTypeId);
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

  /**
   * 검색/필터 + cursor 페이징. 활성(deleted_at IS NULL) 이슈만 대상. 정렬은 (updated_at DESC, id DESC) 고정. size 는
   * 호출자가 1..100 으로 클램프한 값을 넘긴다. assignee 필터는 issue_assignee 매핑에 대한 EXISTS/NOT EXISTS 로 변환된다.
   * typeIds 는 OR 결합.
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
    if (query.typeIds() != null && !query.typeIds().isEmpty()) {
      where = where.and(ISSUE.TYPE_ID.in(query.typeIds()));
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
            ISSUE.TYPE_ID)
        .from(ISSUE)
        .where(where)
        .orderBy(ISSUE.UPDATED_AT.desc(), ISSUE.ID.desc())
        .limit(query.size())
        .fetch(this::mapToRow);
  }

  /** soft-delete: deleted_at = now(). */
  public void softDelete(Long id) {
    dsl.update(ISSUE).set(ISSUE.DELETED_AT, OffsetDateTime.now()).where(ISSUE.ID.eq(id)).execute();
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
            ISSUE.TYPE_ID)
        .from(ISSUE)
        .where(where)
        .orderBy(ISSUE.UPDATED_AT.desc(), ISSUE.ID.desc())
        .limit(size)
        .fetch(this::mapToRow);
  }
}
