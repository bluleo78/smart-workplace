package com.workplace.milestone.repository;

import static com.workplace.jooq.Tables.MILESTONE;

import com.workplace.milestone.dto.MilestoneRow;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;

/**
 * milestone 테이블 jOOQ 리포지토리. UNIQUE(project_id, name) 위반은 DuplicateKeyException 으로 변환. tenant_id 는
 * GUC DEFAULT(current_setting('app.tenant_id')) 가 채우므로 INSERT 시 명시적으로 set 하지 않는다.
 */
@Repository
@RequiredArgsConstructor
public class MilestoneRepository {

  private final DSLContext dsl;

  /** SELECT 결과 → MilestoneRow 매핑. */
  private MilestoneRow mapToRow(Record r) {
    OffsetDateTime created = r.get(MILESTONE.CREATED_AT);
    OffsetDateTime updated = r.get(MILESTONE.UPDATED_AT);
    return new MilestoneRow(
        r.get(MILESTONE.ID),
        r.get(MILESTONE.PROJECT_ID),
        r.get(MILESTONE.NAME),
        r.get(MILESTONE.DUE_DATE),
        r.get(MILESTONE.DESCRIPTION),
        created != null ? created.toInstant() : null,
        updated != null ? updated.toInstant() : null);
  }

  /** id 로 단건 조회. */
  public Optional<MilestoneRow> findById(Long id) {
    return dsl.selectFrom(MILESTONE).where(MILESTONE.ID.eq(id)).fetchOptional(this::mapToRow);
  }

  /** 프로젝트 내 전체 마일스톤 (due_date asc, name asc). */
  public List<MilestoneRow> findByProject(Long projectId) {
    return dsl.selectFrom(MILESTONE)
        .where(MILESTONE.PROJECT_ID.eq(projectId))
        .orderBy(MILESTONE.DUE_DATE.asc(), MILESTONE.NAME.asc())
        .fetch(this::mapToRow);
  }

  /** 신규 마일스톤 삽입. UNIQUE(project_id, name) 위반은 DuplicateKeyException 으로 전파. */
  public MilestoneRow insert(Long projectId, String name, LocalDate dueDate, String description) {
    try {
      return dsl.insertInto(MILESTONE)
          .set(MILESTONE.PROJECT_ID, projectId)
          .set(MILESTONE.NAME, name)
          .set(MILESTONE.DUE_DATE, dueDate)
          .set(MILESTONE.DESCRIPTION, description)
          .returning()
          .fetchOptional()
          .map(this::mapToRow)
          .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("milestone name duplicated", e);
    }
  }

  /** 마일스톤 갱신. */
  public void update(Long id, String name, LocalDate dueDate, String description) {
    try {
      dsl.update(MILESTONE)
          .set(MILESTONE.NAME, name)
          .set(MILESTONE.DUE_DATE, dueDate)
          .set(MILESTONE.DESCRIPTION, description)
          .set(MILESTONE.UPDATED_AT, OffsetDateTime.now())
          .where(MILESTONE.ID.eq(id))
          .execute();
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("milestone name duplicated", e);
    }
  }

  /** 마일스톤 hard-delete (issue.milestone_id ON DELETE SET NULL). */
  public void deleteById(Long id) {
    dsl.deleteFrom(MILESTONE).where(MILESTONE.ID.eq(id)).execute();
  }
}
