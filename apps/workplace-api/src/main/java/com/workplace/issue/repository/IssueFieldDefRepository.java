package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE_FIELD_DEF;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.issue.dto.IssueFieldDefRow;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;

/**
 * issue_field_def jOOQ 리포지토리. options 컬럼은 JSONB ↔ JsonNode 양방향 변환. UNIQUE(project_id,name) 위반은
 * DuplicateKeyException 으로 래핑한다.
 */
@Repository
@RequiredArgsConstructor
public class IssueFieldDefRepository {

  private final DSLContext dsl;
  private final ObjectMapper objectMapper;

  /** jOOQ Record → 내부 row. options JSONB 는 JsonNode 로 파싱 (실패 시 null). */
  private IssueFieldDefRow mapToRow(Record r) {
    OffsetDateTime c = r.get(ISSUE_FIELD_DEF.CREATED_AT);
    OffsetDateTime u = r.get(ISSUE_FIELD_DEF.UPDATED_AT);
    JsonNode options = null;
    JSONB jsonb = r.get(ISSUE_FIELD_DEF.OPTIONS);
    if (jsonb != null) {
      try {
        options = objectMapper.readTree(jsonb.data());
      } catch (Exception e) {
        options = null;
      }
    }
    return new IssueFieldDefRow(
        r.get(ISSUE_FIELD_DEF.ID),
        r.get(ISSUE_FIELD_DEF.PROJECT_ID),
        r.get(ISSUE_FIELD_DEF.NAME),
        r.get(ISSUE_FIELD_DEF.TYPE),
        options,
        r.get(ISSUE_FIELD_DEF.POSITION),
        c != null ? c.toInstant() : null,
        u != null ? u.toInstant() : null);
  }

  /** id 단건 조회. */
  public Optional<IssueFieldDefRow> findById(Long id) {
    return dsl.selectFrom(ISSUE_FIELD_DEF)
        .where(ISSUE_FIELD_DEF.ID.eq(id))
        .fetchOptional(this::mapToRow);
  }

  /** 프로젝트 내 필드 정의 목록 — position asc, id asc. */
  public List<IssueFieldDefRow> findByProject(Long projectId) {
    return dsl.selectFrom(ISSUE_FIELD_DEF)
        .where(ISSUE_FIELD_DEF.PROJECT_ID.eq(projectId))
        .orderBy(ISSUE_FIELD_DEF.POSITION.asc(), ISSUE_FIELD_DEF.ID.asc())
        .fetch(this::mapToRow);
  }

  /** id 집합 → 정의 맵. N+1 회피용 batch 조회. */
  public Map<Long, IssueFieldDefRow> findByIds(List<Long> ids) {
    if (ids == null || ids.isEmpty()) return Map.of();
    Map<Long, IssueFieldDefRow> m = new HashMap<>();
    dsl.selectFrom(ISSUE_FIELD_DEF)
        .where(ISSUE_FIELD_DEF.ID.in(ids))
        .fetch(this::mapToRow)
        .forEach(r -> m.put(r.id(), r));
    return m;
  }

  /** INSERT — 이름 중복은 DuplicateKeyException 으로 정규화. */
  public IssueFieldDefRow insert(
      Long projectId, String name, String type, JsonNode options, int position) {
    try {
      return dsl.insertInto(ISSUE_FIELD_DEF)
          .set(ISSUE_FIELD_DEF.PROJECT_ID, projectId)
          .set(ISSUE_FIELD_DEF.NAME, name)
          .set(ISSUE_FIELD_DEF.TYPE, type)
          .set(ISSUE_FIELD_DEF.OPTIONS, options == null ? null : JSONB.valueOf(options.toString()))
          .set(ISSUE_FIELD_DEF.POSITION, position)
          .returning()
          .fetchOptional()
          .map(this::mapToRow)
          .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("field name duplicated", e);
    }
  }

  /** UPDATE — name / options 만 갱신. type 변경은 서비스 단에서 사전 차단. */
  public void update(Long id, String name, JsonNode options) {
    try {
      dsl.update(ISSUE_FIELD_DEF)
          .set(ISSUE_FIELD_DEF.NAME, name)
          .set(ISSUE_FIELD_DEF.OPTIONS, options == null ? null : JSONB.valueOf(options.toString()))
          .set(ISSUE_FIELD_DEF.UPDATED_AT, OffsetDateTime.now())
          .where(ISSUE_FIELD_DEF.ID.eq(id))
          .execute();
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("field name duplicated", e);
    }
  }

  /** DELETE — issue_field_value 는 FK cascade 로 자동 삭제. */
  public void delete(Long id) {
    dsl.deleteFrom(ISSUE_FIELD_DEF).where(ISSUE_FIELD_DEF.ID.eq(id)).execute();
  }
}
