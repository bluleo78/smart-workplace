package com.workplace.project.repository;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static org.jooq.impl.DSL.count;

import com.workplace.global.tenant.WorkspaceActive;
import com.workplace.project.dto.MemberResponse;
import com.workplace.project.dto.MemberRow;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/** project_member 테이블 리포지토리. */
@Repository
@RequiredArgsConstructor
public class ProjectMemberRepository {

  private final DSLContext dsl;

  /** SELECT 결과 → MemberRow (USER JOIN 없음). */
  private MemberRow mapToRow(Record r) {
    OffsetDateTime created = r.get(PROJECT_MEMBER.CREATED_AT);
    return new MemberRow(
        r.get(PROJECT_MEMBER.PROJECT_ID),
        r.get(PROJECT_MEMBER.USER_ID),
        r.get(PROJECT_MEMBER.ROLE),
        created != null ? created.toInstant() : null);
  }

  /** 특정 프로젝트의 단일 멤버 조회. */
  public Optional<MemberRow> find(Long projectId, Long userId) {
    return dsl.select(
            PROJECT_MEMBER.PROJECT_ID,
            PROJECT_MEMBER.USER_ID,
            PROJECT_MEMBER.ROLE,
            PROJECT_MEMBER.CREATED_AT)
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .fetchOptional(this::mapToRow);
  }

  /** USER JOIN 결과 → MemberResponse. findAllByProject / findMemberWithUser 공유. */
  private MemberResponse mapToMemberResponse(Record r) {
    OffsetDateTime created = r.get(PROJECT_MEMBER.CREATED_AT);
    return new MemberResponse(
        r.get(PROJECT_MEMBER.USER_ID),
        r.get(USER.USERNAME),
        r.get(USER.NAME),
        r.get(USER.KIND),
        r.get(PROJECT_MEMBER.ROLE),
        created != null ? created.toInstant() : null,
        r.get(MEMBER_ACTIVE));
  }

  /**
   * WP-417: 프로젝트 멤버의 active = 이 워크스페이스에서 활성({@link WorkspaceActive}) — 관리자의 「활성 상태」 끄기는 멤버십만 바꾸므로
   * 전역 값만 보면 정지된 구성원이 활성으로 보인다. 멤버십은 프로젝트의 테넌트로 붙인다.
   */
  private static final Field<Boolean> MEMBER_ACTIVE = WorkspaceActive.field();

  /** 프로젝트의 전체 멤버를 USER JOIN 하여 username/name/kind/active 포함된 응답으로 조회. created_at 오름차순. */
  public List<MemberResponse> findAllByProject(Long projectId) {
    return dsl.select(
            PROJECT_MEMBER.USER_ID,
            USER.USERNAME,
            USER.NAME,
            USER.KIND,
            PROJECT_MEMBER.ROLE,
            PROJECT_MEMBER.CREATED_AT,
            MEMBER_ACTIVE)
        .from(PROJECT_MEMBER)
        .join(USER)
        .on(USER.ID.eq(PROJECT_MEMBER.USER_ID))
        .leftJoin(MEMBERSHIP)
        .on(WorkspaceActive.join(PROJECT_MEMBER.USER_ID, PROJECT_MEMBER.TENANT_ID))
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId))
        .orderBy(PROJECT_MEMBER.CREATED_AT.asc())
        .fetch(this::mapToMemberResponse);
  }

  /** username/name/kind/active 까지 채워진 멤버 단건 조회. addMember/updateMemberRole 응답에 사용. */
  public Optional<MemberResponse> findMemberWithUser(Long projectId, Long userId) {
    return dsl.select(
            PROJECT_MEMBER.USER_ID,
            USER.USERNAME,
            USER.NAME,
            USER.KIND,
            PROJECT_MEMBER.ROLE,
            PROJECT_MEMBER.CREATED_AT,
            MEMBER_ACTIVE)
        .from(PROJECT_MEMBER)
        .join(USER)
        .on(USER.ID.eq(PROJECT_MEMBER.USER_ID))
        .leftJoin(MEMBERSHIP)
        .on(WorkspaceActive.join(PROJECT_MEMBER.USER_ID, PROJECT_MEMBER.TENANT_ID))
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .fetchOptional(this::mapToMemberResponse);
  }

  /** 멤버 추가. */
  public void insert(Long projectId, Long userId, String role) {
    dsl.insertInto(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.PROJECT_ID, projectId)
        .set(PROJECT_MEMBER.USER_ID, userId)
        .set(PROJECT_MEMBER.ROLE, role)
        .execute();
  }

  /** 멤버 역할 변경. */
  public void updateRole(Long projectId, Long userId, String role) {
    dsl.update(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.ROLE, role)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /** 멤버 제거. */
  public void delete(Long projectId, Long userId) {
    dsl.deleteFrom(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /**
   * 프로젝트의 OWNER 멤버 행을 잠그고 그 수를 돌려준다(WP-753). 「마지막 소유자」 판정을 이 잠근 집합으로 해야, 두 소유자가 서로를 동시에 강등·제거할 때 나중
   * 요청이 앞 요청의 커밋을 기다렸다가 줄어든 소유자로 판정한다 — {@link #countOwners} 는 둘 다 커밋 전의 소유자 2명을 보고 통과해 소유자 0명이 됐다.
   * 같은 행을 잡는 순서가 엇갈려 교착하지 않게 user_id 순으로 잠근다. 쓰기 트랜잭션에서만 부른다(읽기 전용 트랜잭션은 FOR UPDATE 를 거부한다).
   */
  public long lockOwnersAndCount(Long projectId) {
    return dsl.select(PROJECT_MEMBER.USER_ID)
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.ROLE.eq("OWNER")))
        .orderBy(PROJECT_MEMBER.USER_ID)
        .forUpdate()
        .fetch()
        .size();
  }

  /** 프로젝트의 OWNER 멤버 수. 마지막 OWNER 보호 체크에 사용. */
  public long countOwners(Long projectId) {
    return dsl.select(count())
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.ROLE.eq("OWNER")))
        .fetchOne(0, Long.class);
  }

  /** 프로젝트 멤버의 user_id 목록 — 프로젝트 알림 대상 계산 등. */
  public List<Long> findUserIdsByProject(Long projectId) {
    return dsl.select(PROJECT_MEMBER.USER_ID)
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId))
        .fetch(PROJECT_MEMBER.USER_ID);
  }

  /**
   * 멤버 행을 공유 잠금하고 있는지 돌려준다(WP-776) — 멤버십을 근거로 무언가를 남기는 쓰기(구독 등)가 커밋할 때까지 그 멤버 제거(행 삭제)를 기다리게 하고,
   * 제거가 먼저 커밋됐으면 행이 없어 false 다. 읽기 전용 트랜잭션에서는 쓰지 않는다(PG 가 FOR SHARE 를 거절).
   */
  public boolean lockMember(Long projectId, Long userId) {
    return dsl.selectOne()
            .from(PROJECT_MEMBER)
            .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId)))
            .forShare()
            .fetchOne()
        != null;
  }

  /**
   * 주어진 사용자 중 이 프로젝트 멤버인 user_id 를, 그 멤버 행을 공유 잠금한 채 돌려준다(WP-775) — 담당자 지정이 커밋할 때까지 그 멤버 제거(행 삭제)를
   * 기다리게 하고, 제거가 먼저 커밋됐으면 행이 없어 빠진다. 읽기 전용 트랜잭션에서는 쓰지 않는다(PG 가 FOR SHARE 를 거절).
   */
  public Set<Long> lockMemberUserIds(Long projectId, Collection<Long> userIds) {
    return new HashSet<>(
        dsl.select(PROJECT_MEMBER.USER_ID)
            .from(PROJECT_MEMBER)
            .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.in(userIds)))
            .orderBy(PROJECT_MEMBER.USER_ID)
            .forShare()
            .fetch(PROJECT_MEMBER.USER_ID));
  }

  /** 사용자의 프로젝트 멤버 여부. */
  public boolean isMember(Long projectId, Long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(PROJECT_MEMBER)
            .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId))));
  }

  /**
   * 여러 프로젝트의 멤버 이름을 created_at asc 순으로 한 쿼리에 모은다(N+1 회피).
   *
   * @return projectId → 멤버 이름 리스트(가입순)
   */
  public java.util.Map<Long, java.util.List<String>> findMemberNamesByProjects(
      java.util.List<Long> projectIds) {
    java.util.Map<Long, java.util.List<String>> result = new java.util.LinkedHashMap<>();
    if (projectIds.isEmpty()) return result;
    dsl.select(PROJECT_MEMBER.PROJECT_ID, USER.NAME)
        .from(PROJECT_MEMBER)
        .join(USER)
        .on(USER.ID.eq(PROJECT_MEMBER.USER_ID))
        .where(PROJECT_MEMBER.PROJECT_ID.in(projectIds))
        .orderBy(PROJECT_MEMBER.PROJECT_ID.asc(), PROJECT_MEMBER.CREATED_AT.asc())
        .fetch()
        .forEach(
            r ->
                result
                    .computeIfAbsent(
                        r.get(PROJECT_MEMBER.PROJECT_ID), k -> new java.util.ArrayList<>())
                    .add(r.get(USER.NAME)));
    return result;
  }
}
