package com.workplace.user.repository;

import static com.workplace.jooq.Tables.CONTACT_ENTRY;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;

import com.workplace.user.dto.CreateUserGroupRequest;
import com.workplace.user.dto.UpdateUserGroupRequest;
import com.workplace.user.dto.UserGroupMemberSummary;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 사용자 그룹 저장소. 공유(owner_id NULL)와 호출자 개인(owner_id=caller) 그룹을 평면 조회하고,
 * 멤버는 user/contact_entry 를 직접 JOIN 해 enrich 한다. 폴리모픽 target 은 DB FK 가 없어 앱에서 검증.
 */
@Repository
@RequiredArgsConstructor
public class UserGroupRepository {
  private final DSLContext dsl;

  /** 평면 그룹 레코드(트리 조립 전). */
  public record FlatGroup(
      long id, String code, String name, Long parentId, Long ownerId, String visibility, int sortOrder) {}

  /** 호출자가 볼 수 있는 모든 그룹(공유 전체 + 본인 개인) 평면 조회. */
  public List<FlatGroup> findAccessible(long callerId) {
    return dsl.select(
            USER_GROUP.ID, USER_GROUP.CODE, USER_GROUP.NAME, USER_GROUP.PARENT_ID,
            USER_GROUP.OWNER_ID, USER_GROUP.VISIBILITY, USER_GROUP.SORT_ORDER)
        .from(USER_GROUP)
        .where(USER_GROUP.OWNER_ID.isNull().or(USER_GROUP.OWNER_ID.eq(callerId)))
        .fetch(
            r ->
                new FlatGroup(
                    r.get(USER_GROUP.ID), r.get(USER_GROUP.CODE), r.get(USER_GROUP.NAME),
                    r.get(USER_GROUP.PARENT_ID), r.get(USER_GROUP.OWNER_ID),
                    r.get(USER_GROUP.VISIBILITY), r.get(USER_GROUP.SORT_ORDER)));
  }

  /** 단건 평면 조회(권한·존재 판정용). */
  public Optional<FlatGroup> findById(long id) {
    return dsl.select(
            USER_GROUP.ID, USER_GROUP.CODE, USER_GROUP.NAME, USER_GROUP.PARENT_ID,
            USER_GROUP.OWNER_ID, USER_GROUP.VISIBILITY, USER_GROUP.SORT_ORDER)
        .from(USER_GROUP)
        .where(USER_GROUP.ID.eq(id))
        .fetchOptional(
            r ->
                new FlatGroup(
                    r.get(USER_GROUP.ID), r.get(USER_GROUP.CODE), r.get(USER_GROUP.NAME),
                    r.get(USER_GROUP.PARENT_ID), r.get(USER_GROUP.OWNER_ID),
                    r.get(USER_GROUP.VISIBILITY), r.get(USER_GROUP.SORT_ORDER)));
  }

  /** 그룹 직속 멤버 enrich(MEMBER→user, EXTERNAL→contact_entry). 이름 오름차순. */
  public List<UserGroupMemberSummary> findMembers(long groupId) {
    List<UserGroupMemberSummary> all = new ArrayList<>();
    dsl.select(USER.ID, USER.NAME, USER.EMAIL, USER.TITLE)
        .from(USER_GROUP_MEMBER)
        .join(USER)
        .on(USER.ID.eq(USER_GROUP_MEMBER.TARGET_ID))
        .where(USER_GROUP_MEMBER.GROUP_ID.eq(groupId))
        .and(USER_GROUP_MEMBER.TARGET_TYPE.eq("MEMBER"))
        .fetch()
        .forEach(
            r ->
                all.add(
                    new UserGroupMemberSummary(
                        "MEMBER", r.get(USER.ID), r.get(USER.NAME),
                        r.get(USER.EMAIL), r.get(USER.TITLE), null)));
    dsl.select(
            CONTACT_ENTRY.ID, CONTACT_ENTRY.NAME, CONTACT_ENTRY.EMAIL,
            CONTACT_ENTRY.TITLE, CONTACT_ENTRY.ORGANIZATION)
        .from(USER_GROUP_MEMBER)
        .join(CONTACT_ENTRY)
        .on(CONTACT_ENTRY.ID.eq(USER_GROUP_MEMBER.TARGET_ID))
        .where(USER_GROUP_MEMBER.GROUP_ID.eq(groupId))
        .and(USER_GROUP_MEMBER.TARGET_TYPE.eq("EXTERNAL"))
        .fetch()
        .forEach(
            r ->
                all.add(
                    new UserGroupMemberSummary(
                        "EXTERNAL", r.get(CONTACT_ENTRY.ID), r.get(CONTACT_ENTRY.NAME),
                        r.get(CONTACT_ENTRY.EMAIL), r.get(CONTACT_ENTRY.TITLE),
                        r.get(CONTACT_ENTRY.ORGANIZATION))));
    all.sort(Comparator.comparing(UserGroupMemberSummary::name, String.CASE_INSENSITIVE_ORDER));
    return all;
  }

  /** 그룹 생성. ownerId 는 PERSONAL 만 non-null. 생성 id 반환. */
  public long insert(CreateUserGroupRequest req, Long ownerId) {
    return dsl.insertInto(USER_GROUP)
        .set(USER_GROUP.CODE, nullIfBlank(req.code()))
        .set(USER_GROUP.NAME, req.name())
        .set(USER_GROUP.PARENT_ID, req.parentId())
        .set(USER_GROUP.OWNER_ID, ownerId)
        .set(USER_GROUP.VISIBILITY, req.visibility())
        .set(USER_GROUP.SORT_ORDER, req.sortOrder() == null ? 0 : req.sortOrder())
        .returning(USER_GROUP.ID)
        .fetchOne()
        .getId();
  }

  /** 그룹 수정(name/parent/code/sort). visibility 는 불변. */
  public void update(long id, UpdateUserGroupRequest req) {
    dsl.update(USER_GROUP)
        .set(USER_GROUP.NAME, req.name())
        .set(USER_GROUP.PARENT_ID, req.parentId())
        .set(USER_GROUP.CODE, nullIfBlank(req.code()))
        .set(USER_GROUP.SORT_ORDER, req.sortOrder() == null ? 0 : req.sortOrder())
        .where(USER_GROUP.ID.eq(id))
        .execute();
  }

  /** 그룹 삭제. parent_id·group_id ON DELETE CASCADE 로 서브트리·멤버십 함께 삭제. */
  public void delete(long id) {
    dsl.deleteFrom(USER_GROUP).where(USER_GROUP.ID.eq(id)).execute();
  }

  /** 멤버 편입(멱등 — PK 충돌 시 no-op). */
  public void addMember(long groupId, String targetType, long targetId) {
    dsl.insertInto(USER_GROUP_MEMBER)
        .set(USER_GROUP_MEMBER.GROUP_ID, groupId)
        .set(USER_GROUP_MEMBER.TARGET_TYPE, targetType)
        .set(USER_GROUP_MEMBER.TARGET_ID, targetId)
        .onConflictDoNothing()
        .execute();
  }

  /** 멤버 제외. */
  public void removeMember(long groupId, String targetType, long targetId) {
    dsl.deleteFrom(USER_GROUP_MEMBER)
        .where(USER_GROUP_MEMBER.GROUP_ID.eq(groupId))
        .and(USER_GROUP_MEMBER.TARGET_TYPE.eq(targetType))
        .and(USER_GROUP_MEMBER.TARGET_ID.eq(targetId))
        .execute();
  }

  /** MEMBER 대상 검증 — active HUMAN user 존재 여부. */
  public boolean memberUserExists(long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(USER)
            .where(USER.ID.eq(userId))
            .and(USER.KIND.eq("HUMAN"))
            .and(USER.IS_ACTIVE.isTrue()));
  }

  /** EXTERNAL 대상 검증 — 호출자가 읽을 수 있는 contact_entry 존재 여부(SHARED|owner|admin). */
  public boolean externalReadable(long callerId, boolean admin, long contactId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(CONTACT_ENTRY)
            .where(CONTACT_ENTRY.ID.eq(contactId))
            .and(
                CONTACT_ENTRY
                    .VISIBILITY
                    .eq("SHARED")
                    .or(CONTACT_ENTRY.OWNER_ID.eq(callerId))
                    .or(DSL.condition(admin))));
  }

  private static String nullIfBlank(String s) {
    return (s == null || s.isBlank()) ? null : s;
  }
}
