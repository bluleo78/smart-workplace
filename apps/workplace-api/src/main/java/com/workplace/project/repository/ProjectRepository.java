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
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/** project 테이블 jOOQ 리포지토리. soft-delete(deleted_at IS NULL) 기준으로 활성 row 만 다룬다. */
@Repository
@RequiredArgsConstructor
public class ProjectRepository {

  private final DSLContext dsl;

  /** {@link #mapToRow} 가 읽는 칸 — 프로젝트 행을 읽는 조회가 모두 같은 목록을 쓴다(칸을 더할 때 한 곳만 고치게). */
  private static final List<Field<?>> ROW_FIELDS =
      List.of(
          PROJECT.ID,
          PROJECT.KEY,
          PROJECT.NAME,
          PROJECT.DESCRIPTION,
          PROJECT.OWNER_ID,
          PROJECT.TYPE,
          PROJECT.IS_DEFAULT,
          PROJECT.CREATED_AT,
          PROJECT.UPDATED_AT,
          PROJECT.REPOSITORY_URL,
          PROJECT.REPOSITORY_BRANCH);

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
        updated != null ? updated.toInstant() : null,
        r.get(PROJECT.REPOSITORY_URL),
        r.get(PROJECT.REPOSITORY_BRANCH));
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

  /**
   * id 목록 → 이름 일괄 해석(WP-426 — AI 위임 작업 프로젝트 머리). {@link #keysByIds} 와 같은 모양으로 soft-deleted 는 제외하고,
   * 빈 목록이면 빈 맵.
   */
  public java.util.Map<Long, String> namesByIds(List<Long> ids) {
    if (ids == null || ids.isEmpty()) return java.util.Map.of();
    return dsl.select(PROJECT.ID, PROJECT.NAME)
        .from(PROJECT)
        .where(PROJECT.ID.in(ids).and(PROJECT.DELETED_AT.isNull()))
        .fetchMap(PROJECT.ID, PROJECT.NAME);
  }

  /**
   * id 목록 → 활성 프로젝트 row 를 한 번에 읽는다(soft-deleted 제외). 주어진 id 순서를 지키고 없는 id 는 건너뛴다 — 프로젝트 즐겨찾기
   * 목록(WP-1001)이 즐겨찾기한 순서대로 행마다 따로 읽지 않게 한다.
   */
  public List<ProjectRow> findActiveByIdsInOrder(List<Long> ids) {
    if (ids == null || ids.isEmpty()) return List.of();
    java.util.Map<Long, ProjectRow> byId =
        dsl
            .selectFrom(PROJECT)
            .where(PROJECT.ID.in(ids).and(PROJECT.DELETED_AT.isNull()))
            .fetch()
            .stream()
            .map(this::mapToRow)
            .collect(java.util.stream.Collectors.toMap(ProjectRow::id, r -> r));
    return ids.stream().map(byId::get).filter(java.util.Objects::nonNull).toList();
  }

  /** key 로 활성 프로젝트 조회 (soft-deleted 제외). */
  public Optional<ProjectRow> findByKey(String key) {
    return dsl.select(ROW_FIELDS)
        .from(PROJECT)
        .where(PROJECT.KEY.eq(key).and(PROJECT.DELETED_AT.isNull()))
        .fetchOptional(this::mapToRow);
  }

  /**
   * key 로 활성 프로젝트를 공유 잠금하며 조회(WP-1038) — 다른 프로젝트 에픽을 부모로 붙이는 쓰기가 그 에픽 프로젝트의 삭제와 차례를 세운다. 삭제가 먼저 행을
   * 잠갔으면 커밋을 기다렸다가, 다시 본 행이 삭제돼 있어 빈 값이 된다(PostgreSQL 은 잠금 대기 뒤 조건을 다시 평가한다). 쓰기 트랜잭션 안에서만 부른다.
   */
  public Optional<ProjectRow> findByKeyForShare(String key) {
    return findActiveForShare(PROJECT.KEY.eq(key));
  }

  /** {@link #findByKeyForShare} 의 id 판 — 생성 실행 경로가 부모 이슈의 프로젝트를 잠글 때 쓴다(WP-1038). */
  public Optional<ProjectRow> findByIdForShare(Long id) {
    return findActiveForShare(PROJECT.ID.eq(id));
  }

  /**
   * 조건에 맞는 활성 프로젝트를 공유 잠금하며 조회 — key·id 판 공용(WP-1038). 칸은 {@link #ROW_FIELDS} 를 쓴다 — 칸을 따로 적었다가
   * 같은 날 머지된 연결 저장소 칸(WP-1011)이 빠져 mapToRow 가 실패했다(WP-1045).
   */
  private Optional<ProjectRow> findActiveForShare(Condition condition) {
    return dsl.select(ROW_FIELDS)
        .from(PROJECT)
        .where(condition.and(PROJECT.DELETED_AT.isNull()))
        .forShare()
        .fetchOptional(this::mapToRow);
  }

  /**
   * 활성 프로젝트 행을 쓰기 잠금한다(WP-1038 프로젝트 삭제) — 이 프로젝트 에픽에 하위를 붙이는 요청(프로젝트 공유 잠금)이 삭제 커밋까지 기다리게 하고, 먼저 잠근
   * 요청이 있으면 그것이 끝난 뒤에 다른 프로젝트 하위를 떼어 새로 붙은 하위까지 함께 뗀다.
   *
   * @return 잠갔으면 true, 그사이 지워졌으면 false
   */
  public boolean lockForUpdate(long id) {
    return dsl.select(PROJECT.ID)
        .from(PROJECT)
        .where(PROJECT.ID.eq(id).and(PROJECT.DELETED_AT.isNull()))
        .forUpdate()
        .fetchOptional()
        .isPresent();
  }

  /** id 로 활성 프로젝트 조회 (soft-deleted 제외). */
  public Optional<ProjectRow> findById(Long id) {
    return dsl.select(ROW_FIELDS)
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
   * 사용자에게 보이는 프로젝트 목록을 페이지 단위로 조회. ADMIN 은 모든 활성 프로젝트, 일반 사용자는 본인이 멤버인 프로젝트 + OPEN(공개 접수함) 프로젝트.
   * updated_at desc 정렬.
   */
  public List<ProjectRow> findAllForUser(Long userId, boolean isAdmin, int page, int size) {
    if (isAdmin) {
      return dsl.select(ROW_FIELDS)
          .from(PROJECT)
          .where(adminVisibleCondition(userId))
          .orderBy(PROJECT.UPDATED_AT.desc(), PROJECT.ID.desc())
          .limit(size)
          .offset((long) page * size)
          .fetch(this::mapToRow);
    }
    // JOIN 제거 → EXISTS(멤버) OR OPEN 조건으로 교체: 중복 행 없이 OPEN 프로젝트도 포함
    return dsl.select(ROW_FIELDS)
        .from(PROJECT)
        .where(memberVisibleCondition(userId))
        .orderBy(PROJECT.UPDATED_AT.desc(), PROJECT.ID.desc())
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
    return dsl.select(ROW_FIELDS)
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
        .returning(ROW_FIELDS)
        .fetchOptional()
        .map(this::mapToRow)
        .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"));
  }

  /**
   * name/description 부분 갱신(#858). null 인 필드는 건드리지 않고, clearDescription 이면 설명을 NULL 로 비운다. 저장소
   * 주소·브랜치 (WP-1011)는 빈 문자열이면 지운다(요청 DTO 가 공백을 다듬어 넘긴다). updated_at = now() 는 항상 갱신.
   */
  public void update(
      Long id,
      String name,
      String description,
      boolean clearDescription,
      String repositoryUrl,
      String repositoryBranch) {
    var step = dsl.update(PROJECT).set(PROJECT.UPDATED_AT, OffsetDateTime.now());
    if (name != null) step = step.set(PROJECT.NAME, name);
    if (clearDescription) {
      step = step.set(PROJECT.DESCRIPTION, (String) null);
    } else if (description != null) {
      step = step.set(PROJECT.DESCRIPTION, description);
    }
    if (repositoryUrl != null) {
      step = step.set(PROJECT.REPOSITORY_URL, repositoryUrl.isEmpty() ? null : repositoryUrl);
    }
    if (repositoryBranch != null) {
      step =
          step.set(PROJECT.REPOSITORY_BRANCH, repositoryBranch.isEmpty() ? null : repositoryBranch);
    }
    step.where(PROJECT.ID.eq(id)).execute();
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

  /** 삭제된(soft-deleted) 프로젝트가 이 key 를 쥐고 있는지 — 중복 key 거절 문구를 가르는 데만 쓴다(WP-692). */
  public boolean existsDeletedByKey(String key) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(PROJECT)
            .where(PROJECT.KEY.eq(key))
            .and(PROJECT.DELETED_AT.isNotNull()));
  }
}
