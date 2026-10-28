package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP;

import com.workplace.drive.dto.DriveMemberGroupResponse;
import com.workplace.global.org.Departments;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * drive_space_member_group 접근(WP-1056) — 드라이브 공간 멤버로 둔 조직도 부서 행. 판정(실효 역할·멤버 여부)은 여기가 아니라 {@link
 * DriveSpaceMembership} 이 한다. 여기는 부서 행 관리와 목록만 맡는다(노트의 {@code WikiSpaceMemberGroupRepository} 와 같은
 * 구성).
 */
@Repository
@RequiredArgsConstructor
public class DriveSpaceMemberGroupRepository {
  private final DSLContext dsl;

  /**
   * 공간 멤버 부서(이름순)와 부서마다 지금 들어오는 사람 수 — 그 부서와 하위 부서의 부서 구성원(공통 규칙 {@link
   * Departments#subtreeMembers}, 중복 제외). 접근 판정과 같은 기준이라 보이는 수와 실제로 들어오는 사람이 같다. 모든 부서를 한 번의 조회로 센다.
   */
  public List<DriveMemberGroupResponse> list(long spaceId) {
    return select(DRIVE_SPACE_MEMBER_GROUP.SPACE_ID.eq(spaceId));
  }

  /** 공간 멤버 부서 한 줄(없으면 empty) — 추가·역할 변경 응답용. */
  public Optional<DriveMemberGroupResponse> find(long spaceId, long groupId) {
    return select(key(spaceId, groupId)).stream().findFirst();
  }

  /** 공간·부서 한 행을 가리키는 조건. */
  private static Condition key(long spaceId, long groupId) {
    return DRIVE_SPACE_MEMBER_GROUP
        .SPACE_ID
        .eq(spaceId)
        .and(DRIVE_SPACE_MEMBER_GROUP.GROUP_ID.eq(groupId));
  }

  /** 목록 조회 본체 — 조건에 맞는 부서 행을 인원 수와 함께(이름순). */
  private List<DriveMemberGroupResponse> select(Condition where) {
    var members =
        Departments.subtreeMembers(
            "dmg",
            DSL.select(DRIVE_SPACE_MEMBER_GROUP.GROUP_ID)
                .from(DRIVE_SPACE_MEMBER_GROUP)
                .where(where));
    // 부서별 인원을 한 번에 센다(출발 부서별로 이미 중복을 뺐다) — 부서마다 트리를 다시 돌지 않게 묶어 붙인다.
    var counts =
        DSL.select(members.rootId().as("root_id"), DSL.count().as("member_count"))
            .from(members.table())
            .groupBy(members.rootId())
            .asTable("dmc");
    Field<Long> countRoot = counts.field("root_id", Long.class);
    Field<Integer> memberCount =
        DSL.coalesce(counts.field("member_count", Integer.class), DSL.inline(0));
    return dsl.select(USER_GROUP.ID, USER_GROUP.NAME, DRIVE_SPACE_MEMBER_GROUP.ROLE, memberCount)
        .from(DRIVE_SPACE_MEMBER_GROUP)
        .join(USER_GROUP)
        .on(USER_GROUP.ID.eq(DRIVE_SPACE_MEMBER_GROUP.GROUP_ID))
        .leftJoin(counts)
        .on(countRoot.eq(USER_GROUP.ID))
        .where(where)
        .orderBy(USER_GROUP.NAME.asc(), USER_GROUP.ID.asc())
        .fetch(r -> new DriveMemberGroupResponse(r.value1(), r.value2(), r.value3(), r.value4()));
  }

  /**
   * groupId 가 이 워크스페이스의 조직도 부서(visibility=SHARED)면 그 이름 — 공간 멤버로 받을 수 있는지 검증한다. 다른 테넌트 그룹은 RLS 로,
   * 개인 그룹은 조건으로 빠진다(노트 스페이스 멤버 부서 검증과 같은 규칙).
   */
  public Optional<String> findDepartmentName(long groupId) {
    return dsl.select(USER_GROUP.NAME)
        .from(USER_GROUP)
        .where(USER_GROUP.ID.eq(groupId))
        .and(USER_GROUP.VISIBILITY.eq(Departments.SHARED))
        .fetchOptional(USER_GROUP.NAME);
  }

  /** 부서 행을 더한다 — 이미 있으면 역할을 덮어쓴다(사람 멤버 추가 {@code DriveSpaceMemberRepository#add} 와 같은 업서트). */
  public void upsert(long spaceId, long groupId, String role, long addedBy) {
    dsl.insertInto(DRIVE_SPACE_MEMBER_GROUP)
        .set(DRIVE_SPACE_MEMBER_GROUP.SPACE_ID, spaceId)
        .set(DRIVE_SPACE_MEMBER_GROUP.GROUP_ID, groupId)
        .set(DRIVE_SPACE_MEMBER_GROUP.ROLE, role)
        .set(DRIVE_SPACE_MEMBER_GROUP.ADDED_BY, addedBy)
        .onConflict(DRIVE_SPACE_MEMBER_GROUP.SPACE_ID, DRIVE_SPACE_MEMBER_GROUP.GROUP_ID)
        .doUpdate()
        .set(DRIVE_SPACE_MEMBER_GROUP.ROLE, role)
        .execute();
  }

  /** 부서 행의 역할을 바꾼다. 바뀐 행 수(0 이면 멤버 부서가 아님). */
  public int changeRole(long spaceId, long groupId, String role) {
    return dsl.update(DRIVE_SPACE_MEMBER_GROUP)
        .set(DRIVE_SPACE_MEMBER_GROUP.ROLE, role)
        .where(key(spaceId, groupId))
        .execute();
  }

  /** 부서 행을 지운다. 지운 행 수(0 이면 멤버 부서가 아님). */
  public int remove(long spaceId, long groupId) {
    return dsl.deleteFrom(DRIVE_SPACE_MEMBER_GROUP).where(key(spaceId, groupId)).execute();
  }

  /**
   * groupIds 중 하나를 멤버로 둔 공간 id(오름차순, 중복 없음) — 부서 구성원 감소({@code DepartmentMembersReduced})의 영향을 받는
   * 공간을 찾는다. 이벤트의 부서 목록에는 사람이 빠진 부서의 상위 부서도 들어 있어, 상위 부서를 멤버로 둔 공간도 함께 잡힌다.
   */
  public List<Long> findSpaceIdsByGroups(Collection<Long> groupIds) {
    if (groupIds.isEmpty()) {
      return List.of();
    }
    return dsl.selectDistinct(DRIVE_SPACE_MEMBER_GROUP.SPACE_ID)
        .from(DRIVE_SPACE_MEMBER_GROUP)
        .where(DRIVE_SPACE_MEMBER_GROUP.GROUP_ID.in(groupIds))
        .orderBy(DRIVE_SPACE_MEMBER_GROUP.SPACE_ID.asc())
        .fetch(DRIVE_SPACE_MEMBER_GROUP.SPACE_ID);
  }
}
