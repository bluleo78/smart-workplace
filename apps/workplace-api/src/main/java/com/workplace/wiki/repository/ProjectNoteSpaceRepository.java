package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.PROJECT_MEMBER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.WIKI_SPACE;

import com.workplace.global.org.Departments;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 프로젝트 노트 공간(WP-1480)이 읽는 프로젝트 쪽 테이블. wiki 는 project 패키지의 자바 클래스를 import 하지 않으므로(도메인 간 직접 의존 금지 —
 * 백엔드 CLAUDE.md) 프로젝트·프로젝트 멤버·멤버 부서 테이블을 여기서 jOOQ 로 직접 읽는다. 쓰기는 하지 않는다 — 프로젝트가 진실이고 공간은 그것을 따라간다.
 *
 * <p>가정: project_member.role 은 OWNER|MEMBER, project_member_group 은 조직도 부서(SHARED)만 담는다(프로젝트 쪽 검증).
 * 이 가정이 깨지면 공간 멤버 매핑이 어긋나므로 부서는 SHARED 조건을 한 번 더 건다.
 */
@Repository
@RequiredArgsConstructor
public class ProjectNoteSpaceRepository {
  /** 프로젝트 노트 공간을 두는 프로젝트 유형 — 개인(PERSONAL) 프로젝트는 공간을 만들지 않는다(설계). */
  public static final Set<String> SPACE_PROJECT_TYPES = Set.of("TEAM", "OPEN");

  /** 백필 테넌트 잠금 classId — 다른 advisory lock 네임스페이스(7720·772·1448 등)와 겹치지 않게 이슈 번호로. */
  private static final int BACKFILL_LOCK_CLASS = 1480;

  /** 프로젝트 단위 잠금 classId — 백필(1480)·다른 네임스페이스와 겹치지 않게. */
  private static final int PROJECT_LOCK_CLASS = 14801;

  private final DSLContext dsl;

  /**
   * 프로젝트 요약.
   *
   * @param deleted soft delete 됐는지
   */
  public record ProjectInfo(
      long id, String key, String name, long ownerId, String type, boolean deleted) {
    /** 이 프로젝트가 공간을 가질 수 있는지 — 지워지지 않은 TEAM·OPEN. */
    public boolean hasSpace() {
      return !deleted && SPACE_PROJECT_TYPES.contains(type);
    }
  }

  /** 프로젝트 하나(삭제된 것 포함 — 삭제 이벤트에서도 읽는다). 다른 테넌트는 RLS 로 빠진다. */
  public Optional<ProjectInfo> findProject(long projectId) {
    return dsl.select(
            PROJECT.ID,
            PROJECT.KEY,
            PROJECT.NAME,
            PROJECT.OWNER_ID,
            PROJECT.TYPE,
            PROJECT.DELETED_AT.isNotNull())
        .from(PROJECT)
        .where(PROJECT.ID.eq(projectId))
        .fetchOptional(
            r ->
                new ProjectInfo(
                    r.value1(), r.value2(), r.value3(), r.value4(), r.value5(), r.value6()));
  }

  /** key 로 지워지지 않은 프로젝트를 찾는다(유형 무관 — 부르는 쪽이 {@link ProjectInfo#hasSpace} 로 거른다). */
  public Optional<ProjectInfo> findActiveByKey(String key) {
    return dsl.select(PROJECT.ID)
        .from(PROJECT)
        .where(PROJECT.KEY.eq(key))
        .and(PROJECT.DELETED_AT.isNull())
        .fetchOptional(PROJECT.ID)
        .flatMap(this::findProject);
  }

  /** 프로젝트 직접 멤버 행의 역할(OWNER|MEMBER). 직접 멤버가 아니면 empty — 연결 API 의 「프로젝트 OWNER」 판정용. */
  public Optional<String> findDirectRole(long projectId, long userId) {
    return dsl.select(PROJECT_MEMBER.ROLE)
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId))
        .and(PROJECT_MEMBER.USER_ID.eq(userId))
        .fetchOptional(PROJECT_MEMBER.ROLE);
  }

  /** 프로젝트 직접 멤버(사람·AI) → 역할. 한 번의 조회로 모두 — 멤버 맞추기가 인원 수만큼 조회를 돌리지 않게. */
  public Map<Long, String> findDirectMemberRoles(long projectId) {
    return dsl.select(PROJECT_MEMBER.USER_ID, PROJECT_MEMBER.ROLE)
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId))
        .fetchMap(PROJECT_MEMBER.USER_ID, PROJECT_MEMBER.ROLE);
  }

  /**
   * 「리포트」·리포트·템플릿 작성자(WP-1480·1483 공통 규칙 하나) — 프로젝트 소유자(project.owner_id)가 지금도 프로젝트 직접 멤버면 그 사람,
   * 아니면(이미 떠났으면) 지금 OWNER 직접 멤버 중 가장 작은 id, OWNER 멤버가 없을 때만 owner_id 로 돌아간다. 떠난 사람이 노트 작성자로 보이지 않게.
   * 지워진 프로젝트도 읽는다(프로젝트가 없을 때만 부르는 쪽이 아는 소유자 {@code fallbackOwnerId}).
   */
  public long findReportAuthor(long projectId, long fallbackOwnerId) {
    return findProject(projectId)
        .map(p -> reportAuthor(p.ownerId(), findDirectMemberRoles(projectId)))
        .orElse(fallbackOwnerId);
  }

  /** {@link #findReportAuthor} 의 규칙 — 소유자가 직접 멤버면 소유자, 아니면 가장 작은 OWNER id, 없으면 소유자. */
  static long reportAuthor(long ownerId, Map<Long, String> directRoles) {
    if (directRoles.containsKey(ownerId)) {
      return ownerId;
    }
    return directRoles.entrySet().stream()
        .filter(e -> "OWNER".equals(e.getValue()))
        .map(Map.Entry::getKey)
        .min(Long::compare)
        .orElse(ownerId);
  }

  /** 프로젝트 멤버로 둔 조직도 부서 id — SHARED 만(노트 공간 멤버 부서도 SHARED 만 받는다). */
  public List<Long> findDepartmentGroupIds(long projectId) {
    return dsl.select(PROJECT_MEMBER_GROUP.GROUP_ID)
        .from(PROJECT_MEMBER_GROUP)
        .join(USER_GROUP)
        .on(USER_GROUP.ID.eq(PROJECT_MEMBER_GROUP.GROUP_ID))
        .where(PROJECT_MEMBER_GROUP.PROJECT_ID.eq(projectId))
        .and(USER_GROUP.VISIBILITY.eq(Departments.SHARED))
        .orderBy(PROJECT_MEMBER_GROUP.GROUP_ID)
        .fetch(PROJECT_MEMBER_GROUP.GROUP_ID);
  }

  /** 공간이 없는 지워지지 않은 TEAM·OPEN 프로젝트 id(오름차순) — 백필 대상. */
  public List<Long> findProjectIdsWithoutSpace() {
    return dsl.select(PROJECT.ID)
        .from(PROJECT)
        .where(PROJECT.DELETED_AT.isNull())
        .and(PROJECT.TYPE.in(SPACE_PROJECT_TYPES))
        .andNotExists(
            DSL.selectOne().from(WIKI_SPACE).where(WIKI_SPACE.LINKED_PROJECT_ID.eq(PROJECT.ID)))
        .orderBy(PROJECT.ID)
        .fetch(PROJECT.ID);
  }

  /**
   * 프로젝트 하나의 노트 공간 작업을 차례로 세우는 잠금(트랜잭션 끝에 풀림, WP-1480) — 멤버 맞추기·연결·이름 따라가기·연결 끊기가 같은 프로젝트에서 겹치면 서로의
   * 읽기-후-쓰기 사이에 끼어(예: 연결 중 멤버 추가가 옛 공간에 반영되고 새 공간은 놓침) 공간 멤버가 프로젝트와 어긋난다. key 는 프로젝트 id(int 로 줄인다 —
   * 겹쳐도 차례가 더 엄격해질 뿐이다).
   */
  public void lockProject(long projectId) {
    dsl.execute("SELECT pg_advisory_xact_lock(?, ?)", PROJECT_LOCK_CLASS, (int) projectId);
  }

  /** 백필 테넌트 잠금(트랜잭션 끝에 풀림) — 여러 대가 동시에 기동해도 한 대만 그 테넌트를 처리한다. 못 잡으면 false. */
  public boolean tryLockBackfill(long tenantId) {
    return Boolean.TRUE.equals(
        dsl.fetchValue(
            DSL.field(
                "pg_try_advisory_xact_lock({0}, {1})",
                Boolean.class, DSL.val(BACKFILL_LOCK_CLASS), DSL.val((int) tenantId))));
  }
}
