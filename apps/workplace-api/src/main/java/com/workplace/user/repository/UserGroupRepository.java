package com.workplace.user.repository;

import static com.workplace.jooq.Tables.CONTACT_ENTRY;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;

import com.workplace.user.dto.CreateUserGroupRequest;
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
 * 사용자 그룹 저장소. 공유(owner_id NULL)와 호출자 개인(owner_id=caller) 그룹을 평면 조회하고, 멤버는 user/contact_entry 를 직접
 * JOIN 해 enrich 한다. 폴리모픽 target 은 DB FK 가 없어 앱에서 검증.
 */
@Repository
@RequiredArgsConstructor
public class UserGroupRepository {
  private final DSLContext dsl;

  /** 평면 그룹 레코드(트리 조립 전). */
  public record FlatGroup(
      long id,
      String code,
      String name,
      Long parentId,
      Long ownerId,
      String visibility,
      int sortOrder) {}

  /** 호출자가 볼 수 있는 모든 그룹(공유 전체 + 본인 개인) 평면 조회. */
  public List<FlatGroup> findAccessible(long callerId) {
    return dsl.select(
            USER_GROUP.ID,
            USER_GROUP.CODE,
            USER_GROUP.NAME,
            USER_GROUP.PARENT_ID,
            USER_GROUP.OWNER_ID,
            USER_GROUP.VISIBILITY,
            USER_GROUP.SORT_ORDER)
        .from(USER_GROUP)
        .where(USER_GROUP.OWNER_ID.isNull().or(USER_GROUP.OWNER_ID.eq(callerId)))
        .fetch(
            r ->
                new FlatGroup(
                    r.get(USER_GROUP.ID),
                    r.get(USER_GROUP.CODE),
                    r.get(USER_GROUP.NAME),
                    r.get(USER_GROUP.PARENT_ID),
                    r.get(USER_GROUP.OWNER_ID),
                    r.get(USER_GROUP.VISIBILITY),
                    r.get(USER_GROUP.SORT_ORDER)));
  }

  /** 단건 평면 조회(권한·존재 판정용). */
  public Optional<FlatGroup> findById(long id) {
    return dsl.select(
            USER_GROUP.ID,
            USER_GROUP.CODE,
            USER_GROUP.NAME,
            USER_GROUP.PARENT_ID,
            USER_GROUP.OWNER_ID,
            USER_GROUP.VISIBILITY,
            USER_GROUP.SORT_ORDER)
        .from(USER_GROUP)
        .where(USER_GROUP.ID.eq(id))
        .fetchOptional(
            r ->
                new FlatGroup(
                    r.get(USER_GROUP.ID),
                    r.get(USER_GROUP.CODE),
                    r.get(USER_GROUP.NAME),
                    r.get(USER_GROUP.PARENT_ID),
                    r.get(USER_GROUP.OWNER_ID),
                    r.get(USER_GROUP.VISIBILITY),
                    r.get(USER_GROUP.SORT_ORDER)));
  }

  /**
   * 그룹 직속 멤버 enrich(MEMBER→user, EXTERNAL→contact_entry). 이름 오름차순.
   *
   * <p>MEMBER 는 편입 시점 이후 비활성화·멤버십 해지될 수 있으므로 읽기 시점에도 연락처 목록과 동일한 술어(현재 테넌트 ACTIVE 멤버십 + 활성 HUMAN)로
   * 거른다(#832). 걸러진 행은 삭제하지 않고 숨기기만 한다 — 멤버십이 복구되면 그대로 되살아난다.
   */
  public List<UserGroupMemberSummary> findMembers(long tenantId, long groupId) {
    List<UserGroupMemberSummary> all = new ArrayList<>();
    dsl.select(USER.ID, USER.NAME, USER.EMAIL, USER.TITLE, USER.USERNAME)
        .from(USER_GROUP_MEMBER)
        .join(USER)
        .on(USER.ID.eq(USER_GROUP_MEMBER.TARGET_ID))
        .join(MEMBERSHIP)
        .on(USER.ID.eq(MEMBERSHIP.USER_ID))
        .where(USER_GROUP_MEMBER.GROUP_ID.eq(groupId))
        .and(USER_GROUP_MEMBER.TARGET_TYPE.eq("MEMBER"))
        .and(MEMBERSHIP.TENANT_ID.eq(tenantId))
        .and(MEMBERSHIP.STATUS.eq("ACTIVE"))
        .and(USER.KIND.eq("HUMAN"))
        .and(USER.IS_ACTIVE.isTrue())
        .fetch()
        .forEach(
            r ->
                all.add(
                    new UserGroupMemberSummary(
                        "MEMBER",
                        r.get(USER.ID),
                        r.get(USER.NAME),
                        r.get(USER.EMAIL),
                        r.get(USER.TITLE),
                        null,
                        r.get(USER.USERNAME))));
    dsl.select(
            CONTACT_ENTRY.ID,
            CONTACT_ENTRY.NAME,
            CONTACT_ENTRY.EMAIL,
            CONTACT_ENTRY.TITLE,
            CONTACT_ENTRY.ORGANIZATION)
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
                        "EXTERNAL",
                        r.get(CONTACT_ENTRY.ID),
                        r.get(CONTACT_ENTRY.NAME),
                        r.get(CONTACT_ENTRY.EMAIL),
                        r.get(CONTACT_ENTRY.TITLE),
                        r.get(CONTACT_ENTRY.ORGANIZATION),
                        null)));
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

  /**
   * 그룹 수정(name/parent/code/sort). visibility 는 불변. 서비스가 현재 값과 병합한 최종 값을 받아 전체 컬럼을 쓴다(부분 수정 해석은 서비스
   * 책임, #839).
   */
  public void update(long id, String name, Long parentId, String code, int sortOrder) {
    dsl.update(USER_GROUP)
        .set(USER_GROUP.NAME, name)
        .set(USER_GROUP.PARENT_ID, parentId)
        .set(USER_GROUP.CODE, nullIfBlank(code))
        .set(USER_GROUP.SORT_ORDER, sortOrder)
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

  /**
   * 동일 범위(형제) 내 이름 중복 존재 여부 — 대소문자 무시. 범위는 visibility 별로 다르다: SHARED 는 (parentId), PERSONAL 은
   * (parentId, ownerId) — 서로 다른 소유자의 개인 그룹은 parentId 가 같아도(최상위=NULL) 형제가 아니다. excludeId 는 본인 수정 시
   * 자기 자신을 제외하기 위함(null 이면 생성 시 전체 비교).
   */
  public boolean existsSiblingName(
      Long parentId, String visibility, Long ownerId, String name, Long excludeId) {
    var parentCond =
        parentId == null ? USER_GROUP.PARENT_ID.isNull() : USER_GROUP.PARENT_ID.eq(parentId);
    var cond =
        USER_GROUP
            .VISIBILITY
            .eq(visibility)
            .and(parentCond)
            .and(DSL.lower(USER_GROUP.NAME).eq(name.toLowerCase()));
    if ("PERSONAL".equals(visibility)) {
      cond =
          cond.and(
              ownerId == null ? USER_GROUP.OWNER_ID.isNull() : USER_GROUP.OWNER_ID.eq(ownerId));
    }
    if (excludeId != null) {
      cond = cond.and(USER_GROUP.ID.ne(excludeId));
    }
    return dsl.fetchExists(dsl.selectOne().from(USER_GROUP).where(cond));
  }

  /**
   * MEMBER 대상 검증 — 현재 테넌트의 ACTIVE 멤버십을 가진 활성 HUMAN 인지(#832). user 는 tenant_id/RLS 가 없는 전역 테이블이라
   * membership 조인 없이는 타 테넌트 사용자를 그룹에 편입시킬 수 있다.
   */
  public boolean memberUserExists(long tenantId, long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(USER)
            .join(MEMBERSHIP)
            .on(USER.ID.eq(MEMBERSHIP.USER_ID))
            .where(USER.ID.eq(userId))
            .and(MEMBERSHIP.TENANT_ID.eq(tenantId))
            .and(MEMBERSHIP.STATUS.eq("ACTIVE"))
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
