package com.workplace.view.repository;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.SAVED_VIEW;

import com.workplace.global.share.ProjectMembership;
import com.workplace.view.dto.PinnedSavedViewResponse;
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
        Boolean.TRUE.equals(r.get(SAVED_VIEW.IS_PINNED)),
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

  /**
   * 프로젝트의 저장된 뷰 전부 — 소유자·공개 범위 무관(WP-809). 상태 삭제가 그 상태를 가리키는 다른 사람의 비공개 뷰까지 고쳐야 하므로 권한 거르기 없이
   * 읽는다(서비스가 OWNER 확인 뒤에만 부른다).
   */
  public List<SavedViewRow> findByProject(Long projectId) {
    return dsl.selectFrom(SAVED_VIEW)
        .where(SAVED_VIEW.PROJECT_ID.eq(projectId))
        .orderBy(SAVED_VIEW.ID.asc())
        .fetch(this::mapToRow);
  }

  /** 쿼리만 바꾼다(WP-809) — 상태 삭제로 필터의 상태 id 를 옮기는 시스템 정리라, 사용자가 뷰를 고친 것이 아니므로 updated_at 은 그대로 둔다. */
  public void updateQuery(Long id, String query) {
    dsl.update(SAVED_VIEW).set(SAVED_VIEW.QUERY, query).where(SAVED_VIEW.ID.eq(id)).execute();
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

  /** 뷰 고정/해제. updated_at 갱신. */
  public void setPinned(Long id, boolean pinned) {
    dsl.update(SAVED_VIEW)
        .set(SAVED_VIEW.IS_PINNED, pinned)
        .set(SAVED_VIEW.UPDATED_AT, OffsetDateTime.now())
        .where(SAVED_VIEW.ID.eq(id))
        .execute();
  }

  /**
   * 사용자의 모든 프로젝트 고정뷰 (project 조인, 삭제 프로젝트 제외). 소유자가 해당 프로젝트의 멤버로 여전히 남아 있는 뷰만 반환한다 — 프로젝트를 탈퇴하면 고정뷰
   * 행은 남아 있어 죽은 사이드바 링크가 되므로 프로젝트 멤버십 재확인(직접 멤버 + 조직도 부서, WP-1057)으로 제외한다.
   */
  public List<PinnedSavedViewResponse> findPinnedByUser(Long userId) {
    return dsl.select(
            SAVED_VIEW.ID,
            SAVED_VIEW.PROJECT_ID,
            PROJECT.KEY,
            PROJECT.NAME,
            SAVED_VIEW.NAME,
            SAVED_VIEW.QUERY,
            SAVED_VIEW.CREATED_AT)
        .from(SAVED_VIEW)
        .join(PROJECT)
        .on(SAVED_VIEW.PROJECT_ID.eq(PROJECT.ID))
        .where(
            SAVED_VIEW
                .OWNER_ID
                .eq(userId)
                .and(SAVED_VIEW.IS_PINNED.isTrue())
                .and(PROJECT.DELETED_AT.isNull())
                .and(ProjectMembership.isMemberOf(SAVED_VIEW.PROJECT_ID, userId)))
        .orderBy(SAVED_VIEW.CREATED_AT.desc())
        .fetch(
            r -> {
              OffsetDateTime created = r.get(SAVED_VIEW.CREATED_AT);
              return new PinnedSavedViewResponse(
                  r.get(SAVED_VIEW.ID),
                  r.get(SAVED_VIEW.PROJECT_ID),
                  r.get(PROJECT.KEY),
                  r.get(PROJECT.NAME),
                  r.get(SAVED_VIEW.NAME),
                  r.get(SAVED_VIEW.QUERY),
                  created != null ? created.toInstant() : null);
            });
  }

  /** 뷰 hard-delete. */
  public void delete(Long id) {
    dsl.deleteFrom(SAVED_VIEW).where(SAVED_VIEW.ID.eq(id)).execute();
  }
}
