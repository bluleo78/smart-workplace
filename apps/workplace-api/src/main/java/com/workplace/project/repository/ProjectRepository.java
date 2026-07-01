package com.workplace.project.repository;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static org.jooq.impl.DSL.count;
import static org.jooq.impl.DSL.exists;

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
        r.get(PROJECT.TYPE),
        Boolean.TRUE.equals(r.get(PROJECT.IS_DEFAULT)),
        created != null ? created.toInstant() : null,
        updated != null ? updated.toInstant() : null);
  }

  /**
   * id 목록 → key 일괄 해석. 프로젝트 횡단 검색(홈 /me/issues)에서 row 별 projectId 를 projectKey 로 바꿀 때 사용. 빈 목록이면 빈
   * 맵.
   */
  public java.util.Map<Long, String> keysByIds(List<Long> ids) {
    if (ids == null || ids.isEmpty()) return java.util.Map.of();
    return dsl.select(PROJECT.ID, PROJECT.KEY)
        .from(PROJECT)
        .where(PROJECT.ID.in(ids).and(PROJECT.DELETED_AT.isNull()))
        .fetchMap(PROJECT.ID, PROJECT.KEY);
  }

  /** key 로 활성 프로젝트 조회 (soft-deleted 제외). */
  public Optional<ProjectRow> findByKey(String key) {
    return dsl.select(
            PROJECT.ID,
            PROJECT.KEY,
            PROJECT.NAME,
            PROJECT.DESCRIPTION,
            PROJECT.OWNER_ID,
            PROJECT.TYPE,
            PROJECT.IS_DEFAULT,
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
            PROJECT.TYPE,
            PROJECT.IS_DEFAULT,
            PROJECT.CREATED_AT,
            PROJECT.UPDATED_AT)
        .from(PROJECT)
        .where(PROJECT.ID.eq(id).and(PROJECT.DELETED_AT.isNull()))
        .fetchOptional(this::mapToRow);
  }

  /** ADMIN 가시 범위: TEAM·OPEN 전체 + 본인 PERSONAL (개인 프로젝트 완전 비공개 정책). */
  private org.jooq.Condition adminVisibleCondition(Long userId) {
    return PROJECT
        .DELETED_AT
        .isNull()
        .and(
            PROJECT
                .TYPE
                .in("TEAM", "OPEN") // OPEN 도 ADMIN 전체 가시
                .or(PROJECT.OWNER_ID.eq(userId)));
  }

  /**
   * 일반 사용자 프로젝트 가시 조건: 활성(deleted_at IS NULL) AND (멤버 EXISTS OR OPEN 유형). JOIN 대신 EXISTS 를 사용해 멤버
   * 중복 행 없이 단일 결과를 보장한다.
   */
  private org.jooq.Condition memberVisibleCondition(Long userId) {
    return PROJECT
        .DELETED_AT
        .isNull()
        .and(
            exists(
                    dsl.selectOne()
                        .from(PROJECT_MEMBER)
                        .where(
                            PROJECT_MEMBER
                                .PROJECT_ID
                                .eq(PROJECT.ID)
                                .and(PROJECT_MEMBER.USER_ID.eq(userId))))
                .or(PROJECT.TYPE.eq("OPEN")));
  }

  /**
   * 사용자에게 보이는 프로젝트 목록을 페이지 단위로 조회. ADMIN 은 모든 활성 프로젝트, 일반 사용자는 본인이 멤버인 프로젝트 + OPEN(공개 접수함) 프로젝트. updated_at desc 정렬.
   */
  public List<ProjectRow> findAllForUser(Long userId, boolean isAdmin, int page, int size) {
    if (isAdmin) {
      return dsl.select(
              PROJECT.ID,
              PROJECT.KEY,
              PROJECT.NAME,
              PROJECT.DESCRIPTION,
              PROJECT.OWNER_ID,
              PROJECT.TYPE,
              PROJECT.IS_DEFAULT,
              PROJECT.CREATED_AT,
              PROJECT.UPDATED_AT)
          .from(PROJECT)
          .where(adminVisibleCondition(userId))
          .orderBy(PROJECT.UPDATED_AT.desc())
          .limit(size)
          .offset((long) page * size)
          .fetch(this::mapToRow);
    }
    // JOIN 제거 → EXISTS(멤버) OR OPEN 조건으로 교체: 중복 행 없이 OPEN 프로젝트도 포함
    return dsl.select(
            PROJECT.ID,
            PROJECT.KEY,
            PROJECT.NAME,
            PROJECT.DESCRIPTION,
            PROJECT.OWNER_ID,
            PROJECT.TYPE,
            PROJECT.IS_DEFAULT,
            PROJECT.CREATED_AT,
            PROJECT.UPDATED_AT)
        .from(PROJECT)
        .where(memberVisibleCondition(userId))
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
          .where(adminVisibleCondition(userId))
          .fetchOne(0, Long.class);
    }
    // findAllForUser 와 동일한 헬퍼 조건으로 카운트 — 술어 드리프트 방지
    return dsl.select(count())
        .from(PROJECT)
        .where(memberVisibleCondition(userId))
        .fetchOne(0, Long.class);
  }

  /** 소유자의 기본 개인 프로젝트(있으면). */
  public Optional<ProjectRow> findDefaultPersonal(Long ownerId) {
    return dsl.select(
            PROJECT.ID,
            PROJECT.KEY,
            PROJECT.NAME,
            PROJECT.DESCRIPTION,
            PROJECT.OWNER_ID,
            PROJECT.TYPE,
            PROJECT.IS_DEFAULT,
            PROJECT.CREATED_AT,
            PROJECT.UPDATED_AT)
        .from(PROJECT)
        .where(
            PROJECT
                .OWNER_ID
                .eq(ownerId)
                .and(PROJECT.TYPE.eq("PERSONAL"))
                .and(PROJECT.IS_DEFAULT.isTrue())
                .and(PROJECT.DELETED_AT.isNull()))
        .fetchOptional(this::mapToRow);
  }

  /** 신규 프로젝트 INSERT 후 생성된 row 반환. type/isDefault 로 TEAM/PERSONAL·기본 프로젝트 여부를 지정. */
  public ProjectRow insert(
      String key, String name, String description, Long ownerId, String type, boolean isDefault) {
    return dsl.insertInto(PROJECT)
        .set(PROJECT.KEY, key)
        .set(PROJECT.NAME, name)
        .set(PROJECT.DESCRIPTION, description)
        .set(PROJECT.OWNER_ID, ownerId)
        .set(PROJECT.TYPE, type)
        .set(PROJECT.IS_DEFAULT, isDefault)
        .returning(
            PROJECT.ID,
            PROJECT.KEY,
            PROJECT.NAME,
            PROJECT.DESCRIPTION,
            PROJECT.OWNER_ID,
            PROJECT.TYPE,
            PROJECT.IS_DEFAULT,
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
