package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static org.jooq.impl.DSL.count;

import com.workplace.issue.dto.IssueTypeRow;
import com.workplace.issue.dto.IssueTypeSummary;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;

/** 이슈 유형 정의 jOOQ 리포지토리. 시스템/CUSTOM 양쪽 CRUD + 응답 임베딩용 batch 조회 제공. */
@Repository
@RequiredArgsConstructor
public class IssueTypeRepository {

  private final DSLContext dsl;

  /** SELECT 결과를 {@link IssueTypeRow} 로 매핑. */
  private IssueTypeRow mapToRow(Record r) {
    OffsetDateTime c = r.get(ISSUE_TYPE_DEF.CREATED_AT);
    OffsetDateTime u = r.get(ISSUE_TYPE_DEF.UPDATED_AT);
    return new IssueTypeRow(
        r.get(ISSUE_TYPE_DEF.ID),
        r.get(ISSUE_TYPE_DEF.PROJECT_ID),
        r.get(ISSUE_TYPE_DEF.NAME),
        r.get(ISSUE_TYPE_DEF.COLOR_TOKEN),
        r.get(ISSUE_TYPE_DEF.ICON),
        r.get(ISSUE_TYPE_DEF.IS_SYSTEM),
        r.get(ISSUE_TYPE_DEF.POSITION),
        c != null ? c.toInstant() : null,
        u != null ? u.toInstant() : null);
  }

  /** id 로 단건 조회. */
  public Optional<IssueTypeRow> findById(Long id) {
    return dsl.selectFrom(ISSUE_TYPE_DEF)
        .where(ISSUE_TYPE_DEF.ID.eq(id))
        .fetchOptional(this::mapToRow);
  }

  /** (project, name) 으로 조회. 시스템 유형 fallback 등에서 사용. */
  public Optional<IssueTypeRow> findByProjectAndName(Long projectId, String name) {
    return dsl.selectFrom(ISSUE_TYPE_DEF)
        .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(projectId).and(ISSUE_TYPE_DEF.NAME.eq(name)))
        .fetchOptional(this::mapToRow);
  }

  /** 프로젝트 내 모든 유형을 position, id 순으로 반환. */
  public List<IssueTypeRow> findByProject(Long projectId) {
    return dsl.selectFrom(ISSUE_TYPE_DEF)
        .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(projectId))
        .orderBy(ISSUE_TYPE_DEF.POSITION.asc(), ISSUE_TYPE_DEF.ID.asc())
        .fetch(this::mapToRow);
  }

  /** N+1 회피용 batch — id 집합 → Map&lt;id, summary&gt;. 빈 입력은 빈 맵. */
  public Map<Long, IssueTypeSummary> findByIds(List<Long> ids) {
    if (ids == null || ids.isEmpty()) return Map.of();
    Map<Long, IssueTypeSummary> result = new HashMap<>();
    dsl.select(
            ISSUE_TYPE_DEF.ID, ISSUE_TYPE_DEF.NAME, ISSUE_TYPE_DEF.COLOR_TOKEN, ISSUE_TYPE_DEF.ICON)
        .from(ISSUE_TYPE_DEF)
        .where(ISSUE_TYPE_DEF.ID.in(ids))
        .fetch()
        .forEach(
            r ->
                result.put(
                    r.value1(),
                    new IssueTypeSummary(r.value1(), r.value2(), r.value3(), r.value4())));
    return result;
  }

  /** 사용 중 이슈 카운트 — CUSTOM 유형 삭제 가드용. soft-delete 된 이슈는 제외. */
  public int countIssuesByType(Long typeId) {
    Integer c =
        dsl.select(count())
            .from(ISSUE)
            .where(ISSUE.TYPE_ID.eq(typeId).and(ISSUE.DELETED_AT.isNull()))
            .fetchOne(0, Integer.class);
    return c == null ? 0 : c;
  }

  /** INSERT. UNIQUE 위반은 {@link DuplicateKeyException} 으로 변환하여 서비스 계층에서 일관 처리. */
  public IssueTypeRow insert(
      Long projectId, String name, String colorToken, String icon, boolean isSystem, int position) {
    try {
      return dsl.insertInto(ISSUE_TYPE_DEF)
          .set(ISSUE_TYPE_DEF.PROJECT_ID, projectId)
          .set(ISSUE_TYPE_DEF.NAME, name)
          .set(ISSUE_TYPE_DEF.COLOR_TOKEN, colorToken)
          .set(ISSUE_TYPE_DEF.ICON, icon)
          .set(ISSUE_TYPE_DEF.IS_SYSTEM, isSystem)
          .set(ISSUE_TYPE_DEF.POSITION, position)
          .returning()
          .fetchOptional()
          .map(this::mapToRow)
          .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("type name duplicated", e);
    }
  }

  /** 이름/색상/아이콘 갱신. updated_at = now(). */
  public void update(Long id, String name, String colorToken, String icon) {
    try {
      dsl.update(ISSUE_TYPE_DEF)
          .set(ISSUE_TYPE_DEF.NAME, name)
          .set(ISSUE_TYPE_DEF.COLOR_TOKEN, colorToken)
          .set(ISSUE_TYPE_DEF.ICON, icon)
          .set(ISSUE_TYPE_DEF.UPDATED_AT, OffsetDateTime.now())
          .where(ISSUE_TYPE_DEF.ID.eq(id))
          .execute();
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("type name duplicated", e);
    }
  }

  /** 유형 삭제. issue.type_id 가 RESTRICT 이므로 사용 중이면 RDB 가 막는다 (서비스에서 사전 가드). */
  public void delete(Long id) {
    dsl.deleteFrom(ISSUE_TYPE_DEF).where(ISSUE_TYPE_DEF.ID.eq(id)).execute();
  }
}
