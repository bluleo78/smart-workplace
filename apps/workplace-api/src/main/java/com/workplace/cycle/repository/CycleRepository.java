package com.workplace.cycle.repository;

import static com.workplace.jooq.Tables.CYCLE;

import com.workplace.cycle.dto.CycleRow;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;

/** cycle 테이블 jOOQ 리포지토리. UNIQUE(project_id, name) 위반은 DuplicateKeyException 으로 변환. */
@Repository
@RequiredArgsConstructor
public class CycleRepository {

  private final DSLContext dsl;

  /** SELECT 결과 → CycleRow 매핑. */
  private CycleRow mapToRow(Record r) {
    OffsetDateTime created = r.get(CYCLE.CREATED_AT);
    OffsetDateTime updated = r.get(CYCLE.UPDATED_AT);
    return new CycleRow(
        r.get(CYCLE.ID),
        r.get(CYCLE.PROJECT_ID),
        r.get(CYCLE.NAME),
        r.get(CYCLE.GOAL),
        r.get(CYCLE.START_DATE),
        r.get(CYCLE.END_DATE),
        r.get(CYCLE.STATUS),
        created != null ? created.toInstant() : null,
        updated != null ? updated.toInstant() : null);
  }

  /** id 로 단건 조회. */
  public Optional<CycleRow> findById(Long id) {
    return dsl.selectFrom(CYCLE).where(CYCLE.ID.eq(id)).fetchOptional(this::mapToRow);
  }

  /** 프로젝트 내 전체 사이클 (start_date desc nulls last, name asc). */
  public List<CycleRow> findByProject(Long projectId) {
    return dsl.selectFrom(CYCLE)
        .where(CYCLE.PROJECT_ID.eq(projectId))
        .orderBy(CYCLE.START_DATE.desc().nullsLast(), CYCLE.NAME.asc())
        .fetch(this::mapToRow);
  }

  /** id 집합으로 일괄 조회. */
  public List<CycleRow> findByIds(List<Long> ids) {
    if (ids == null || ids.isEmpty()) return List.of();
    return dsl.selectFrom(CYCLE).where(CYCLE.ID.in(ids)).fetch(this::mapToRow);
  }

  /** 신규 사이클 삽입. UNIQUE(project_id, name) 위반은 DuplicateKeyException 으로 전파. */
  public CycleRow insert(
      Long projectId,
      String name,
      String goal,
      java.time.LocalDate startDate,
      java.time.LocalDate endDate,
      String status) {
    try {
      return dsl.insertInto(CYCLE)
          .set(CYCLE.PROJECT_ID, projectId)
          .set(CYCLE.NAME, name)
          .set(CYCLE.GOAL, goal)
          .set(CYCLE.START_DATE, startDate)
          .set(CYCLE.END_DATE, endDate)
          .set(CYCLE.STATUS, status)
          .returning()
          .fetchOptional()
          .map(this::mapToRow)
          .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("cycle name duplicated", e);
    }
  }

  /** 사이클 갱신. */
  public void update(
      Long id,
      String name,
      String goal,
      java.time.LocalDate startDate,
      java.time.LocalDate endDate,
      String status) {
    try {
      dsl.update(CYCLE)
          .set(CYCLE.NAME, name)
          .set(CYCLE.GOAL, goal)
          .set(CYCLE.START_DATE, startDate)
          .set(CYCLE.END_DATE, endDate)
          .set(CYCLE.STATUS, status)
          .set(CYCLE.UPDATED_AT, OffsetDateTime.now())
          .where(CYCLE.ID.eq(id))
          .execute();
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("cycle name duplicated", e);
    }
  }

  /** 사이클 hard-delete (issue_cycle cascade). */
  public void delete(Long id) {
    dsl.deleteFrom(CYCLE).where(CYCLE.ID.eq(id)).execute();
  }
}
