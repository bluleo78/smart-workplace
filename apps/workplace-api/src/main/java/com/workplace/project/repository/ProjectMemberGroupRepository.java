package com.workplace.project.repository;

import static com.workplace.jooq.Tables.PROJECT_MEMBER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP;

import com.workplace.global.org.Departments;
import com.workplace.global.share.ProjectMembership;
import com.workplace.project.dto.ProjectMemberGroupResponse;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * project_member_group 접근(WP-1057) — 팀 프로젝트 멤버로 둔 조직도 부서 행. 판정(실효 역할·멤버 여부)은 여기가 아니라 공용 {@link
 * ProjectMembership} 이 한다. 여기는 부서 행 관리와 목록, 부서 변화의 영향을 받는 프로젝트 찾기만 맡는다(노트 스페이스의 {@code
 * WikiSpaceMemberGroupRepository} 와 같은 짜임).
 */
@Repository
@RequiredArgsConstructor
public class ProjectMemberGroupRepository {
  private final DSLContext dsl;

  /**
   * 프로젝트 멤버 부서(이름순)와 부서마다 지금 들어오는 사람 수 — 그 부서와 하위 부서의 부서 구성원(공통 규칙 {@link
   * Departments#subtreeMembers}, 중복 제외). 접근 판정과 같은 기준이라 보이는 수와 실제로 들어오는 사람이 같다. 모든 부서를 한 번의 조회로 센다.
   */
  public List<ProjectMemberGroupResponse> list(long projectId) {
    return select(PROJECT_MEMBER_GROUP.PROJECT_ID.eq(projectId));
  }

  /** 프로젝트 멤버 부서 한 줄(없으면 empty) — 추가 응답용. */
  public Optional<ProjectMemberGroupResponse> find(long projectId, long groupId) {
    return select(
            PROJECT_MEMBER_GROUP
                .PROJECT_ID
                .eq(projectId)
                .and(PROJECT_MEMBER_GROUP.GROUP_ID.eq(groupId)))
        .stream()
        .findFirst();
  }

  /** 목록 조회 본체 — 조건에 맞는 부서 행을 인원 수와 함께(이름순). */
  private List<ProjectMemberGroupResponse> select(Condition where) {
    var members =
        Departments.subtreeMembers(
            "pmg",
            DSL.select(PROJECT_MEMBER_GROUP.GROUP_ID).from(PROJECT_MEMBER_GROUP).where(where));
    // 부서별 인원을 한 번에 센다(출발 부서별로 이미 중복을 뺐다) — 부서마다 트리를 다시 돌지 않게 묶어 붙인다.
    var counts =
        DSL.select(members.rootId().as("root_id"), DSL.count().as("member_count"))
            .from(members.table())
            .groupBy(members.rootId())
            .asTable("pmgc");
    Field<Long> countRoot = counts.field("root_id", Long.class);
    Field<Integer> memberCount =
        DSL.coalesce(counts.field("member_count", Integer.class), DSL.inline(0));
    return dsl.select(USER_GROUP.ID, USER_GROUP.NAME, PROJECT_MEMBER_GROUP.ROLE, memberCount)
        .from(PROJECT_MEMBER_GROUP)
        .join(USER_GROUP)
        .on(USER_GROUP.ID.eq(PROJECT_MEMBER_GROUP.GROUP_ID))
        .leftJoin(counts)
        .on(countRoot.eq(USER_GROUP.ID))
        .where(where)
        .orderBy(USER_GROUP.NAME.asc(), USER_GROUP.ID.asc())
        .fetch(r -> new ProjectMemberGroupResponse(r.value1(), r.value2(), r.value3(), r.value4()));
  }

  /** 이 프로젝트에 그 부서 행이 있는가. */
  public boolean exists(long projectId, long groupId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(PROJECT_MEMBER_GROUP)
            .where(PROJECT_MEMBER_GROUP.PROJECT_ID.eq(projectId))
            .and(PROJECT_MEMBER_GROUP.GROUP_ID.eq(groupId)));
  }

  /**
   * groupId 가 이 워크스페이스의 조직도 부서(visibility=SHARED)면 그 이름 — 프로젝트 멤버로 받을 수 있는지 검증한다. 다른 테넌트 그룹은 RLS 로,
   * 개인 그룹은 조건으로 빠진다(노트 스페이스 멤버 부서 검증과 같은 규칙).
   */
  public Optional<String> findDepartmentName(long groupId) {
    return dsl.select(USER_GROUP.NAME)
        .from(USER_GROUP)
        .where(USER_GROUP.ID.eq(groupId))
        .and(USER_GROUP.VISIBILITY.eq(Departments.SHARED))
        .fetchOptional(USER_GROUP.NAME);
  }

  /** 부서 행을 더한다 — 역할은 늘 MEMBER(부서에는 OWNER 를 주지 않는다). */
  public void insert(long projectId, long groupId, long addedBy) {
    dsl.insertInto(PROJECT_MEMBER_GROUP)
        .set(PROJECT_MEMBER_GROUP.PROJECT_ID, projectId)
        .set(PROJECT_MEMBER_GROUP.GROUP_ID, groupId)
        .set(PROJECT_MEMBER_GROUP.ROLE, ProjectMembership.GROUP_ROLE)
        .set(PROJECT_MEMBER_GROUP.ADDED_BY, addedBy)
        .execute();
  }

  /** 부서 행을 지운다. 지운 행 수를 돌려준다(동시 제거면 0). */
  public int delete(long projectId, long groupId) {
    return dsl.deleteFrom(PROJECT_MEMBER_GROUP)
        .where(PROJECT_MEMBER_GROUP.PROJECT_ID.eq(projectId))
        .and(PROJECT_MEMBER_GROUP.GROUP_ID.eq(groupId))
        .execute();
  }

  /**
   * groupIds 중 하나를 멤버로 둔 프로젝트 id(오름차순, 중복 없음) — 부서 구성원 감소({@code DepartmentMembersReduced})의 영향을 받는
   * 프로젝트를 찾는다. 이벤트의 부서 목록에는 사람이 빠진 부서의 상위 부서도 들어 있어, 상위 부서를 멤버로 둔 프로젝트도 함께 잡힌다. 증가 쪽은 프로젝트마다 실은 부서
   * id 가 필요해 {@link #findGroupIdsByProjectAmong} 을 쓴다.
   */
  public List<Long> findProjectIdsByGroups(Collection<Long> groupIds) {
    if (groupIds.isEmpty()) {
      return List.of();
    }
    return dsl.selectDistinct(PROJECT_MEMBER_GROUP.PROJECT_ID)
        .from(PROJECT_MEMBER_GROUP)
        .where(PROJECT_MEMBER_GROUP.GROUP_ID.in(groupIds))
        .orderBy(PROJECT_MEMBER_GROUP.PROJECT_ID.asc())
        .fetch(PROJECT_MEMBER_GROUP.PROJECT_ID);
  }

  /**
   * 주어진 부서 중 하나를 멤버로 둔 프로젝트별 멤버 부서 id(WP-1166) — 프로젝트 id 오름차순, 키마다 그 프로젝트에 실제로 들어 있는 부서만. 조직도 변경
   * 알림이 프로젝트마다 자기 부서 행만 싣게 한다(이벤트에는 상위 부서도 함께 담겨 온다).
   */
  public Map<Long, List<Long>> findGroupIdsByProjectAmong(Collection<Long> groupIds) {
    if (groupIds.isEmpty()) {
      return Map.of();
    }
    return dsl.select(PROJECT_MEMBER_GROUP.PROJECT_ID, PROJECT_MEMBER_GROUP.GROUP_ID)
        .from(PROJECT_MEMBER_GROUP)
        .where(PROJECT_MEMBER_GROUP.GROUP_ID.in(groupIds))
        .orderBy(PROJECT_MEMBER_GROUP.PROJECT_ID.asc(), PROJECT_MEMBER_GROUP.GROUP_ID.asc())
        .fetchGroups(PROJECT_MEMBER_GROUP.PROJECT_ID, PROJECT_MEMBER_GROUP.GROUP_ID);
  }

  /**
   * 사람(userId)이 직접 속한 조직도 부서와 그 상위 부서 중 하나를 멤버로 둔 프로젝트 id(오름차순) — 활성 여부는 보지 않는다({@link
   * Departments#withAncestorsOfIncludingInactive}). 구성원 정지 뒤에도 그 사람이 부서로 들어와 있던 프로젝트를 찾게 한다.
   */
  public List<Long> findProjectIdsReachableByMembership(long userId) {
    return dsl.selectDistinct(PROJECT_MEMBER_GROUP.PROJECT_ID)
        .from(PROJECT_MEMBER_GROUP)
        .where(
            PROJECT_MEMBER_GROUP.GROUP_ID.in(
                Departments.withAncestorsOfIncludingInactive(DSL.val(userId))))
        .orderBy(PROJECT_MEMBER_GROUP.PROJECT_ID.asc())
        .fetch(PROJECT_MEMBER_GROUP.PROJECT_ID);
  }
}
