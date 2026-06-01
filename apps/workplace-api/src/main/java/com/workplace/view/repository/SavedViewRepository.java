package com.workplace.view.repository;

import static com.workplace.jooq.Tables.SAVED_VIEW;

import com.workplace.view.dto.SavedViewRow;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;

/** saved_view jOOQ 리포지토리. UNIQUE(project_id, owner_id, name) 위반은 DuplicateKeyException 으로 변환. */
@Repository
@RequiredArgsConstructor
public class SavedViewRepository {

  private final DSLContext dsl;

  /** SELECT 결과 → SavedViewRow 매핑. */
  private SavedViewRow mapToRow(Record r) {
    OffsetDateTime created = r.get(SAVED_VIEW.CREATED_AT);
    OffsetDateTime updated = r.get(SAVED_VIEW.UPDATED_AT);
    return new SavedViewRow(
        r.get(SAVED_VIEW.ID),
        r.get(SAVED_VIEW.PROJECT_ID),
        r.get(SAVED_VIEW.OWNER_ID),
        r.get(SAVED_VIEW.NAME),
        r.get(SAVED_VIEW.QUERY),
        r.get(SAVED_VIEW.VISIBILITY),
        created != null ? created.toInstant() : null,
        updated != null ? updated.toInstant() : null);
  }

  /** 호출자에게 보이는 뷰 — 프로젝트의 SHARED ∪ 내 소유(가시성 무관). 이름 오름차순. */
  public List<SavedViewRow> findVisible(Long projectId, Long userId) {
    return dsl.selectFrom(SAVED_VIEW)
        .where(
            SAVED_VIEW
                .PROJECT_ID
                .eq(projectId)
                .and(SAVED_VIEW.VISIBILITY.eq("SHARED").or(SAVED_VIEW.OWNER_ID.eq(userId))))
        .orderBy(SAVED_VIEW.NAME.asc())
        .fetch(this::mapToRow);
  }

  /** id 로 단건 조회. */
  public Optional<SavedViewRow> findById(Long id) {
    return dsl.selectFrom(SAVED_VIEW).where(SAVED_VIEW.ID.eq(id)).fetchOptional(this::mapToRow);
  }

  /** 신규 뷰 삽입. UNIQUE(project_id, owner_id, name) 위반은 DuplicateKeyException 으로 전파. */
  public SavedViewRow insert(
      Long projectId, Long ownerId, String name, String query, String visibility) {
    try {
      return dsl.insertInto(SAVED_VIEW)
          .set(SAVED_VIEW.PROJECT_ID, projectId)
          .set(SAVED_VIEW.OWNER_ID, ownerId)
          .set(SAVED_VIEW.NAME, name)
          .set(SAVED_VIEW.QUERY, query)
          .set(SAVED_VIEW.VISIBILITY, visibility)
          .returning()
          .fetchOptional()
          .map(this::mapToRow)
          .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("saved_view name duplicated", e);
    }
  }

  /** 이름/쿼리/가시성 갱신. UNIQUE 위반은 DuplicateKeyException 으로 전파. */
  public void update(Long id, String name, String query, String visibility) {
    try {
      dsl.update(SAVED_VIEW)
          .set(SAVED_VIEW.NAME, name)
          .set(SAVED_VIEW.QUERY, query)
          .set(SAVED_VIEW.VISIBILITY, visibility)
          .set(SAVED_VIEW.UPDATED_AT, OffsetDateTime.now())
          .where(SAVED_VIEW.ID.eq(id))
          .execute();
    } catch (org.jooq.exception.IntegrityConstraintViolationException e) {
      throw new DuplicateKeyException("saved_view name duplicated", e);
    }
  }

  /** 뷰 hard-delete. */
  public void delete(Long id) {
    dsl.deleteFrom(SAVED_VIEW).where(SAVED_VIEW.ID.eq(id)).execute();
  }
}
