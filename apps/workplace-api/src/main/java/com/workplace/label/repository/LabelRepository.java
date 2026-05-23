package com.workplace.label.repository;

import static com.workplace.jooq.Tables.LABEL;

import com.workplace.label.dto.LabelRow;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;

/** label 테이블 jOOQ 리포지토리. UNIQUE(project_id, name) 위반은 DuplicateKeyException 으로 변환. */
@Repository
@RequiredArgsConstructor
public class LabelRepository {

  private final DSLContext dsl;

  /** SELECT 결과 → LabelRow 매핑. */
  private LabelRow mapToRow(Record r) {
    OffsetDateTime created = r.get(LABEL.CREATED_AT);
    OffsetDateTime updated = r.get(LABEL.UPDATED_AT);
    return new LabelRow(
        r.get(LABEL.ID),
        r.get(LABEL.PROJECT_ID),
        r.get(LABEL.NAME),
        r.get(LABEL.COLOR_TOKEN),
        created != null ? created.toInstant() : null,
        updated != null ? updated.toInstant() : null);
  }

  /** id 로 단건 조회. */
  public Optional<LabelRow> findById(Long id) {
    return dsl.selectFrom(LABEL).where(LABEL.ID.eq(id)).fetchOptional(this::mapToRow);
  }

  /** 프로젝트 내 전체 라벨 (name asc). */
  public List<LabelRow> findByProject(Long projectId) {
    return dsl.selectFrom(LABEL)
        .where(LABEL.PROJECT_ID.eq(projectId))
        .orderBy(LABEL.NAME.asc())
        .fetch(this::mapToRow);
  }

  /** id 집합으로 일괄 조회. */
  public List<LabelRow> findByIds(List<Long> ids) {
    if (ids == null || ids.isEmpty()) return List.of();
    return dsl.selectFrom(LABEL).where(LABEL.ID.in(ids)).fetch(this::mapToRow);
  }

  /** 신규 라벨 삽입. UNIQUE(project_id, name) 위반은 DuplicateKeyException 으로 전파. */
  public LabelRow insert(Long projectId, String name, String colorToken) {
    try {
      return dsl.insertInto(LABEL)
          .set(LABEL.PROJECT_ID, projectId)
          .set(LABEL.NAME, name)
          .set(LABEL.COLOR_TOKEN, colorToken)
          .returning()
          .fetchOptional()
          .map(this::mapToRow)
          .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("label name duplicated", e);
    }
  }

  /** 이름/색상 갱신. */
  public void update(Long id, String name, String colorToken) {
    try {
      dsl.update(LABEL)
          .set(LABEL.NAME, name)
          .set(LABEL.COLOR_TOKEN, colorToken)
          .set(LABEL.UPDATED_AT, OffsetDateTime.now())
          .where(LABEL.ID.eq(id))
          .execute();
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("label name duplicated", e);
    }
  }

  /** 라벨 hard-delete (cascade). */
  public void delete(Long id) {
    dsl.deleteFrom(LABEL).where(LABEL.ID.eq(id)).execute();
  }
}
