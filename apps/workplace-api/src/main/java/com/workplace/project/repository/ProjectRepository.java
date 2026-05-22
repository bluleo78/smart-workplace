package com.workplace.project.repository;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static org.jooq.impl.DSL.count;

import com.workplace.project.dto.ProjectRow;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/** project 테이블 jOOQ 리포지토리. soft-delete(deleted_at IS NULL) 기준으로 활성 row 만 다룬다. */
@Repository
@RequiredArgsConstructor
public class ProjectRepository {

  private final DSLContext dsl;

  /** 공통 매핑: SELECT 결과 → {@link ProjectRow}. OffsetDateTime → Instant 변환. */
  private ProjectRow mapToRow(Record r) {
    OffsetDateTime created = r.get(PROJECT.CREATED_AT);
    OffsetDateTime updated = r.get(PROJECT.UPDATED_AT);
    return new ProjectRow(
        r.get(PROJECT.ID),
        r.get(PROJECT.KEY),
        r.get(PROJECT.NAME),
        r.get(PROJECT.DESCRIPTION),
        r.get(PROJECT.OWNER_ID),
        created != null ? created.toInstant() : null,
        updated != null ? updated.toInstant() : null);
  }

  /** key 로 활성 프로젝트 조회 (soft-deleted 제외). */
  public Optional<ProjectRow> findByKey(String key) {
    return dsl.select(
            PROJECT.ID,
            PROJECT.KEY,
            PROJECT.NAME,
            PROJECT.DESCRIPTION,
            PROJECT.OWNER_ID,
            PROJECT.CREATED_AT,
            PROJECT.UPDATED_AT)
        .from(PROJECT)
        .where(PROJECT.KEY.eq(key).and(PROJECT.DELETED_AT.isNull()))
        .fetchOptional(this::mapToRow);
  }

  /** id 로 활성 프로젝트 조회 (soft-deleted 제외). */
  public Optional<ProjectRow> findById(Long id) {
    return dsl.select(
            PROJECT.ID,
            PROJECT.KEY,
            PROJECT.NAME,
            PROJECT.DESCRIPTION,
            PROJECT.OWNER_ID,
            PROJECT.CREATED_AT,
            PROJECT.UPDATED_AT)
        .from(PROJECT)
        .where(PROJECT.ID.eq(id).and(PROJECT.DELETED_AT.isNull()))
        .fetchOptional(this::mapToRow);
  }

  /**
   * 사용자에게 보이는 프로젝트 목록을 페이지 단위로 조회. ADMIN 은 모든 활성 프로젝트, 일반 사용자는 본인이 멤버인 프로젝트만. updated_at desc 정렬.
   */
  public List<ProjectRow> findAllForUser(Long userId, boolean isAdmin, int page, int size) {
    if (isAdmin) {
      return dsl.select(
              PROJECT.ID,
              PROJECT.KEY,
              PROJECT.NAME,
              PROJECT.DESCRIPTION,
              PROJECT.OWNER_ID,
              PROJECT.CREATED_AT,
              PROJECT.UPDATED_AT)
          .from(PROJECT)
          .where(PROJECT.DELETED_AT.isNull())
          .orderBy(PROJECT.UPDATED_AT.desc())
          .limit(size)
          .offset((long) page * size)
          .fetch(this::mapToRow);
    }
    return dsl.select(
            PROJECT.ID,
            PROJECT.KEY,
            PROJECT.NAME,
            PROJECT.DESCRIPTION,
            PROJECT.OWNER_ID,
            PROJECT.CREATED_AT,
            PROJECT.UPDATED_AT)
        .from(PROJECT)
        .join(PROJECT_MEMBER)
        .on(PROJECT_MEMBER.PROJECT_ID.eq(PROJECT.ID))
        .where(PROJECT.DELETED_AT.isNull().and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .orderBy(PROJECT.UPDATED_AT.desc())
        .limit(size)
        .offset((long) page * size)
        .fetch(this::mapToRow);
  }

  /** 사용자에게 보이는 프로젝트 총 개수. */
  public long countForUser(Long userId, boolean isAdmin) {
    if (isAdmin) {
      return dsl.select(count())
          .from(PROJECT)
          .where(PROJECT.DELETED_AT.isNull())
          .fetchOne(0, Long.class);
    }
    return dsl.select(count())
        .from(PROJECT)
        .join(PROJECT_MEMBER)
        .on(PROJECT_MEMBER.PROJECT_ID.eq(PROJECT.ID))
        .where(PROJECT.DELETED_AT.isNull().and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .fetchOne(0, Long.class);
  }

  /** 신규 프로젝트 INSERT 후 생성된 row 반환. */
  public ProjectRow insert(String key, String name, String description, Long ownerId) {
    return dsl.insertInto(PROJECT)
        .set(PROJECT.KEY, key)
        .set(PROJECT.NAME, name)
        .set(PROJECT.DESCRIPTION, description)
        .set(PROJECT.OWNER_ID, ownerId)
        .returning(
            PROJECT.ID,
            PROJECT.KEY,
            PROJECT.NAME,
            PROJECT.DESCRIPTION,
            PROJECT.OWNER_ID,
            PROJECT.CREATED_AT,
            PROJECT.UPDATED_AT)
        .fetchOptional()
        .map(this::mapToRow)
        .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
  }

  /** name/description 갱신. updated_at = now(). */
  public void update(Long id, String name, String description) {
    dsl.update(PROJECT)
        .set(PROJECT.NAME, name)
        .set(PROJECT.DESCRIPTION, description)
        .set(PROJECT.UPDATED_AT, OffsetDateTime.now())
        .where(PROJECT.ID.eq(id))
        .execute();
  }

  /** soft-delete: deleted_at = now(). */
  public void softDelete(Long id) {
    dsl.update(PROJECT)
        .set(PROJECT.DELETED_AT, OffsetDateTime.now())
        .where(PROJECT.ID.eq(id))
        .execute();
  }

  /** key UNIQUE 제약 충돌 사전 체크. soft-deleted 도 포함하여 검사 (DB UNIQUE 가 그러하므로). */
  public boolean existsByKey(String key) {
    return dsl.fetchExists(dsl.selectOne().from(PROJECT).where(PROJECT.KEY.eq(key)));
  }
}
