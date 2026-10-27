package com.workplace.user;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.AddMemberRequest;
import com.workplace.user.dto.CreateUserGroupRequest;
import com.workplace.user.dto.UpdateUserGroupRequest;
import com.workplace.user.dto.UserGroupDetail;
import com.workplace.user.dto.UserGroupTreeResponse;
import com.workplace.user.exception.InvalidUserGroupException;
import com.workplace.user.exception.UserGroupForbiddenException;
import com.workplace.user.exception.UserGroupNotFoundException;
import com.workplace.user.service.UserGroupService;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 사용자 그룹 서비스 통합 테스트 — CRUD·트리·멤버십·권한격리·사이클·캐스케이드. */
@Transactional
class UserGroupServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired UserGroupService service;

  /** 고유 username 의 HUMAN user 시드, id 반환. */
  private long user() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "u_" + t)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "User " + t)
            .set(USER.EMAIL, t + "@example.com")
            .set(USER.KIND, "HUMAN")
            .set(USER.IS_ACTIVE, true)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // MEMBER 편입 검증이 현재 테넌트 ACTIVE 멤버십을 요구하므로(#832) 실제 프로비저닝과 동일하게 함께 시드한다.
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  /** user 에 ADMIN 역할 부여(ADMIN 은 user-group:manage 권한 보유). */
  private void makeAdmin(long userId) {
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
  }

  private CreateUserGroupRequest req(String name, Long parentId, String visibility) {
    return new CreateUserGroupRequest(name, parentId, visibility, null, 0);
  }

  @Test
  void create_personal_byPlainUser_succeeds_andOwnerIsCaller() {
    long caller = user();
    UserGroupDetail g = service.create(caller, req("내 그룹", null, "PERSONAL"));
    assertThat(g.visibility()).isEqualTo("PERSONAL");
    assertThat(g.ownerId()).isEqualTo(caller);
  }

  @Test
  void create_shared_byPlainUser_throwsForbidden() {
    long caller = user();
    assertThatThrownBy(() -> service.create(caller, req("부서", null, "SHARED")))
        .isInstanceOf(UserGroupForbiddenException.class);
  }

  @Test
  void create_shared_byAdmin_succeeds() {
    long admin = user();
    makeAdmin(admin);
    UserGroupDetail g = service.create(admin, req("부서", null, "SHARED"));
    assertThat(g.visibility()).isEqualTo("SHARED");
    assertThat(g.ownerId()).isNull();
  }

  @Test
  void getTree_returnsSharedAndOwnPersonal_nested() {
    long admin = user();
    makeAdmin(admin);
    UserGroupDetail root = service.create(admin, req("본부", null, "SHARED"));
    service.create(admin, req("팀", root.id(), "SHARED"));
    service.create(admin, req("내 분류", null, "PERSONAL"));

    UserGroupTreeResponse tree = service.getTree(admin);
    // 공유 그룹은 owner_id NULL 로 전역 가시 → 공유 테스트 DB 드리프트 방지를 위해
    // 개수 단정 대신 이름으로 찾아 자식 구조만 검증한다.
    var bonbu = tree.shared().stream().filter(n -> "본부".equals(n.name())).findFirst().orElseThrow();
    assertThat(bonbu.children()).hasSize(1);
    assertThat(bonbu.children().get(0).name()).isEqualTo("팀");
    // 개인 그룹은 owner 스코프(새로 만든 admin 소유) → 정확히 1개.
    assertThat(tree.personal()).hasSize(1);
    assertThat(tree.personal().get(0).name()).isEqualTo("내 분류");
  }

  @Test
  void getTree_personalIsolation_otherUsersPersonalHidden() {
    long a = user();
    long b = user();
    service.create(a, req("A 그룹", null, "PERSONAL"));
    UserGroupTreeResponse treeB = service.getTree(b);
    assertThat(treeB.personal()).isEmpty();
  }

  @Test
  void addMember_member_and_external_polymorphic() {
    long caller = user();
    long memberUser = user();
    long contactId =
        dsl.insertInto(com.workplace.jooq.Tables.CONTACT_ENTRY)
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.NAME, "외부")
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.OWNER_ID, caller)
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.VISIBILITY, "PERSONAL")
            .returning(com.workplace.jooq.Tables.CONTACT_ENTRY.ID)
            .fetchOne()
            .getId();
    UserGroupDetail g = service.create(caller, req("내 그룹", null, "PERSONAL"));

    service.addMember(caller, g.id(), new AddMemberRequest("MEMBER", memberUser));
    UserGroupDetail after =
        service.addMember(caller, g.id(), new AddMemberRequest("EXTERNAL", contactId));

    assertThat(after.members()).hasSize(2);
    assertThat(after.members())
        .anyMatch(m -> m.targetType().equals("MEMBER") && m.targetId() == memberUser);
    assertThat(after.members())
        .anyMatch(m -> m.targetType().equals("EXTERNAL") && m.targetId() == contactId);
    // #839: MEMBER 는 username 을 실어 AI 도구가 숫자 id 대신 username 으로 가리키게 한다. EXTERNAL 은 null.
    String expectedUsername =
        dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(memberUser)).fetchOne(USER.USERNAME);
    assertThat(after.members())
        .anyMatch(m -> m.targetType().equals("MEMBER") && expectedUsername.equals(m.username()));
    assertThat(after.members())
        .filteredOn(m -> m.targetType().equals("EXTERNAL"))
        .allMatch(m -> m.username() == null);
  }

  /** 사람 이름을 바꾼다 — 검색어로 고르기 쉽게. */
  private void rename(long userId, String name) {
    dsl.update(USER).set(USER.NAME, name).where(USER.ID.eq(userId)).execute();
  }

  /**
   * 하위 조직 포함 검색(WP-1000) — 상위 조직에서 찾으면 하위 팀 구성원까지 나오고 각자 속한 그룹이 실린다. 두 팀에 있는 사람은 찾은 그룹에 가까운 소속 하나만,
   * 검색어에 맞지 않는 사람은 빠진다.
   */
  @Test
  void searchMembers_includesSubgroups_withNearestGroup() {
    long caller = user();
    long direct = user();
    long inTeam = user();
    long inBoth = user();
    long other = user();
    rename(direct, "김본부");
    rename(inTeam, "김재경");
    rename(inBoth, "김겸직");
    rename(other, "이다른");
    UserGroupDetail hq = service.create(caller, req("경영지원본부", null, "PERSONAL"));
    UserGroupDetail team = service.create(caller, req("재경팀", hq.id(), "PERSONAL"));
    UserGroupDetail part = service.create(caller, req("결산파트", team.id(), "PERSONAL"));
    service.addMember(caller, hq.id(), new AddMemberRequest("MEMBER", direct));
    service.addMember(caller, part.id(), new AddMemberRequest("MEMBER", inTeam));
    service.addMember(caller, team.id(), new AddMemberRequest("MEMBER", inBoth));
    service.addMember(caller, part.id(), new AddMemberRequest("MEMBER", inBoth));
    service.addMember(caller, team.id(), new AddMemberRequest("MEMBER", other));

    var hits = service.searchMembers(caller, hq.id(), "김");

    assertThat(hits)
        .extracting(h -> h.targetId() + "@" + h.groupId())
        .containsExactly(
            // 이름순 — 김겸직·김본부·김재경. 김겸직은 재경팀·결산파트 둘에 있어 가까운 재경팀으로.
            inBoth + "@" + team.id(), direct + "@" + hq.id(), inTeam + "@" + part.id());
    // 소속 경로 — 찾은 그룹부터 속한 그룹까지, 직속은 빈 경로.
    assertThat(hits)
        .extracting(h -> String.join(" › ", h.groupPath()))
        .containsExactly("경영지원본부 › 재경팀", "", "경영지원본부 › 재경팀 › 결산파트");
    // 와일드카드 문자는 글자 그대로 — 「%」로 모두가 나오지 않는다.
    assertThat(service.searchMembers(caller, hq.id(), "%")).isEmpty();
    // 하위 팀에서 찾으면 그 위(본부 직속)는 나오지 않는다.
    assertThat(service.searchMembers(caller, team.id(), "김"))
        .extracting(h -> h.targetId())
        .containsExactlyInAnyOrder(inBoth, inTeam);
    // 빈 검색어면 하위 조직 포함 전체.
    assertThat(service.searchMembers(caller, hq.id(), " ")).hasSize(4);
  }

  /** 관리자가 남의 개인 그룹에서 찾아도 그 주인의 개인 하위 그룹까지 찾는다(관리자 자신의 트리가 아니라 주인의 트리 기준). */
  @Test
  void searchMembers_adminOnOthersPersonalGroup_includesItsSubgroups() {
    long owner = user();
    long admin = user();
    makeAdmin(admin);
    long inTeam = user();
    rename(inTeam, "김재경");
    UserGroupDetail hq = service.create(owner, req("본부", null, "PERSONAL"));
    UserGroupDetail team = service.create(owner, req("팀", hq.id(), "PERSONAL"));
    service.addMember(owner, team.id(), new AddMemberRequest("MEMBER", inTeam));

    assertThat(service.searchMembers(admin, hq.id(), "김"))
        .extracting(h -> h.targetId())
        .containsExactly(inTeam);
  }

  /** 남의 개인 그룹은 하위 조직 포함 검색도 없는 것처럼 404 — 상세 조회와 같은 존재 은닉. */
  @Test
  void searchMembers_otherUsersPersonalGroup_notFound() {
    long owner = user();
    long stranger = user();
    UserGroupDetail g = service.create(owner, req("내 그룹", null, "PERSONAL"));
    assertThatThrownBy(() -> service.searchMembers(stranger, g.id(), "김"))
        .isInstanceOf(UserGroupNotFoundException.class);
  }

  /** 편입 이후 비활성화된 멤버는 그룹 상세(조직도)에서도 사라진다(#832) — 목록/상세와 동일 술어. 행 자체는 남으므로 재활성화 시 되살아난다. */
  @Test
  void groupMembers_hideDeactivatedUser() {
    long caller = user();
    long memberUser = user();
    UserGroupDetail g = service.create(caller, req("내 그룹", null, "PERSONAL"));
    service.addMember(caller, g.id(), new AddMemberRequest("MEMBER", memberUser));
    assertThat(service.getDetail(caller, g.id()).members()).hasSize(1);

    dsl.update(USER).set(USER.IS_ACTIVE, false).where(USER.ID.eq(memberUser)).execute();

    assertThat(service.getDetail(caller, g.id()).members()).isEmpty();
  }

  /** 타 테넌트 사용자는 그룹 MEMBER 로 편입할 수 없다(#832) — user 는 전역 테이블이라 id 만으로 접근 가능하기 때문. */
  @Test
  void addMember_rejectsUserOfOtherTenant() {
    long caller = user();
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long otherTenant =
        dsl.insertInto(TENANT)
            .set(TENANT.SLUG, "t_" + t)
            .set(TENANT.NAME, "tenant " + t)
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();
    long foreign =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "uf_" + t)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Foreign " + t)
            .set(USER.EMAIL, "f_" + t + "@example.com")
            .set(USER.KIND, "HUMAN")
            .set(USER.IS_ACTIVE, true)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, foreign)
        .set(MEMBERSHIP.TENANT_ID, otherTenant)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    UserGroupDetail g = service.create(caller, req("내 그룹", null, "PERSONAL"));

    assertThatThrownBy(
            () -> service.addMember(caller, g.id(), new AddMemberRequest("MEMBER", foreign)))
        .isInstanceOf(InvalidUserGroupException.class);
  }

  /** WP-553: 정지된 구성원은 「존재하지 않음」이 아니라 정지라는 실제 이유로 거절하고, 안내에 내부 id 를 붙이지 않는다. */
  @Test
  void addMember_suspendedMember_rejectedWithSuspendedReason() {
    long caller = user();
    long suspended = user();
    dsl.update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(suspended))
        .and(MEMBERSHIP.TENANT_ID.eq(1L))
        .execute();
    UserGroupDetail g = service.create(caller, req("내 그룹", null, "PERSONAL"));
    assertThatThrownBy(
            () -> service.addMember(caller, g.id(), new AddMemberRequest("MEMBER", suspended)))
        .isInstanceOf(InvalidUserGroupException.class)
        .hasMessage("정지된 구성원은 그룹에 넣을 수 없습니다");
  }

  /** WP-553: 없는 사용자(타 테넌트 포함)는 id 없이 「이 워크스페이스의 구성원이 아닙니다」로 거절한다. */
  @Test
  void addMember_unknownMember_rejectedWithoutInternalId() {
    long caller = user();
    UserGroupDetail g = service.create(caller, req("내 그룹", null, "PERSONAL"));
    assertThatThrownBy(
            () -> service.addMember(caller, g.id(), new AddMemberRequest("MEMBER", 987654321L)))
        .isInstanceOf(InvalidUserGroupException.class)
        .hasMessage("이 워크스페이스의 구성원이 아닙니다");
  }

  @Test
  void addMember_duplicate_isIdempotent() {
    long caller = user();
    long memberUser = user();
    UserGroupDetail g = service.create(caller, req("내 그룹", null, "PERSONAL"));
    service.addMember(caller, g.id(), new AddMemberRequest("MEMBER", memberUser));
    UserGroupDetail after =
        service.addMember(caller, g.id(), new AddMemberRequest("MEMBER", memberUser));
    assertThat(after.members()).hasSize(1);
  }

  /**
   * WP-547: 공유 그룹 상세에는 호출자가 볼 수 있는 외부 연락처만 — 관리자가 남의 PERSONAL 연락처를 넣었거나, 넣은 뒤 소유자가 PERSONAL 로 바꿨어도
   * 다른 구성원에게 이름·이메일이 새지 않는다. 소유자·관리자에게는 그대로 보인다.
   */
  @Test
  void getDetail_sharedGroup_hidesExternalsCallerCannotRead() {
    long admin = user();
    makeAdmin(admin);
    long owner = user();
    long viewer = user();
    long personal =
        dsl.insertInto(com.workplace.jooq.Tables.CONTACT_ENTRY)
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.NAME, "오세훈")
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.OWNER_ID, owner)
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.VISIBILITY, "PERSONAL")
            .returning(com.workplace.jooq.Tables.CONTACT_ENTRY.ID)
            .fetchOne()
            .getId();
    long shared =
        dsl.insertInto(com.workplace.jooq.Tables.CONTACT_ENTRY)
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.NAME, "한지민")
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.OWNER_ID, owner)
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.VISIBILITY, "SHARED")
            .returning(com.workplace.jooq.Tables.CONTACT_ENTRY.ID)
            .fetchOne()
            .getId();
    UserGroupDetail g = service.create(admin, req("전략 파트너사", null, "SHARED"));
    service.addMember(admin, g.id(), new AddMemberRequest("EXTERNAL", personal));
    service.addMember(admin, g.id(), new AddMemberRequest("EXTERNAL", shared));

    assertThat(service.getDetail(viewer, g.id()).members())
        .extracting(m -> m.targetId())
        .containsExactly(shared);
    assertThat(service.getDetail(owner, g.id()).members()).hasSize(2);
    assertThat(service.getDetail(admin, g.id()).members()).hasSize(2);
  }

  @Test
  void addMember_invisibleExternal_rejected() {
    long caller = user();
    long other = user();
    long privContact =
        dsl.insertInto(com.workplace.jooq.Tables.CONTACT_ENTRY)
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.NAME, "남의 연락처")
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.OWNER_ID, other)
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.VISIBILITY, "PERSONAL")
            .returning(com.workplace.jooq.Tables.CONTACT_ENTRY.ID)
            .fetchOne()
            .getId();
    UserGroupDetail g = service.create(caller, req("내 그룹", null, "PERSONAL"));
    assertThatThrownBy(
            () -> service.addMember(caller, g.id(), new AddMemberRequest("EXTERNAL", privContact)))
        .isInstanceOf(InvalidUserGroupException.class);
  }

  @Test
  void removeMember_removesRow() {
    long caller = user();
    long memberUser = user();
    UserGroupDetail g = service.create(caller, req("내 그룹", null, "PERSONAL"));
    service.addMember(caller, g.id(), new AddMemberRequest("MEMBER", memberUser));
    service.removeMember(caller, g.id(), "MEMBER", memberUser);
    UserGroupDetail after = service.getDetail(caller, g.id());
    assertThat(after.members()).isEmpty();
  }

  @Test
  void removeMember_unknownTargetType_throwsInvalidAndKeepsMember() {
    // WP-551: 소문자 member 등 알 수 없는 대상 종류는 0행 삭제 204 로 끝내지 않고 400 으로 거절한다.
    long caller = user();
    long memberUser = user();
    UserGroupDetail g = service.create(caller, req("내 그룹", null, "PERSONAL"));
    service.addMember(caller, g.id(), new AddMemberRequest("MEMBER", memberUser));
    assertThatThrownBy(() -> service.removeMember(caller, g.id(), "member", memberUser))
        .isInstanceOf(InvalidUserGroupException.class)
        .hasMessageContaining("대상 종류");
    assertThat(service.getDetail(caller, g.id()).members()).hasSize(1);
  }

  @Test
  void getDetail_personalByNonOwner_throwsNotFound() {
    long a = user();
    long b = user();
    UserGroupDetail g = service.create(a, req("A 그룹", null, "PERSONAL"));
    assertThatThrownBy(() -> service.getDetail(b, g.id()))
        .isInstanceOf(UserGroupNotFoundException.class);
  }

  @Test
  void update_sharedByPlainUser_throwsForbidden() {
    long admin = user();
    makeAdmin(admin);
    long plain = user();
    UserGroupDetail g = service.create(admin, req("부서", null, "SHARED"));
    assertThatThrownBy(
            () ->
                service.update(
                    plain, g.id(), new UpdateUserGroupRequest("수정", null, null, null, null, null)))
        .isInstanceOf(UserGroupForbiddenException.class);
  }

  @Test
  void update_parentToOwnDescendant_throwsInvalid() {
    long caller = user();
    UserGroupDetail parent = service.create(caller, req("부모", null, "PERSONAL"));
    UserGroupDetail child = service.create(caller, req("자식", parent.id(), "PERSONAL"));
    // 부모를 자식의 하위로 옮기려는 시도 → 사이클
    assertThatThrownBy(
            () ->
                service.update(
                    caller,
                    parent.id(),
                    new UpdateUserGroupRequest(null, child.id(), null, null, null, null)))
        .isInstanceOf(InvalidUserGroupException.class);
  }

  @Test
  void delete_cascadesSubtreeAndMemberships() {
    long caller = user();
    long memberUser = user();
    UserGroupDetail parent = service.create(caller, req("부모", null, "PERSONAL"));
    UserGroupDetail child = service.create(caller, req("자식", parent.id(), "PERSONAL"));
    service.addMember(caller, child.id(), new AddMemberRequest("MEMBER", memberUser));

    service.delete(caller, parent.id());

    assertThat(dsl.fetchCount(USER_GROUP, USER_GROUP.ID.in(parent.id(), child.id()))).isZero();
    assertThat(dsl.fetchCount(USER_GROUP_MEMBER, USER_GROUP_MEMBER.GROUP_ID.eq(child.id())))
        .isZero();
  }

  @Test
  void update_setParentToNull_makesRoot() {
    long caller = user();
    UserGroupDetail parent = service.create(caller, req("부모", null, "PERSONAL"));
    UserGroupDetail child = service.create(caller, req("자식", parent.id(), "PERSONAL"));
    UserGroupDetail updated =
        service.update(
            caller, child.id(), new UpdateUserGroupRequest(null, null, true, null, null, null));
    assertThat(updated.parentId()).isNull();
  }

  @Test
  void update_partial_keepsOmittedFields() {
    // #839: 이름만 보내면 parent·code·sortOrder 는 현재 값 유지(이전엔 전체 교체라 최상위로 튀고 code 가 지워졌다).
    long caller = user();
    UserGroupDetail parent =
        service.create(caller, req("부모" + UUID.randomUUID(), null, "PERSONAL"));
    UserGroupDetail child =
        service.create(caller, new CreateUserGroupRequest("자식", parent.id(), "PERSONAL", "C-1", 7));
    UserGroupDetail updated =
        service.update(
            caller, child.id(), new UpdateUserGroupRequest("새이름", null, null, null, null, null));
    assertThat(updated.name()).isEqualTo("새이름");
    assertThat(updated.parentId()).isEqualTo(parent.id());
    assertThat(updated.code()).isEqualTo("C-1");
    assertThat(updated.sortOrder()).isEqualTo(7);
  }

  @Test
  void update_clearCode_nullsCodeAndKeepsName() {
    long caller = user();
    String name = "코드그룹" + UUID.randomUUID();
    UserGroupDetail g =
        service.create(caller, new CreateUserGroupRequest(name, null, "PERSONAL", "X-9", 0));
    UserGroupDetail updated =
        service.update(
            caller, g.id(), new UpdateUserGroupRequest(null, null, null, null, true, null));
    assertThat(updated.code()).isNull();
    assertThat(updated.name()).isEqualTo(name);
  }

  @Test
  void update_valueWithClearFlag_throwsInvalid() {
    // 값과 비우기 플래그를 함께 주면 모호 — 400(InvalidUserGroupException).
    long caller = user();
    UserGroupDetail parent =
        service.create(caller, req("부모" + UUID.randomUUID(), null, "PERSONAL"));
    UserGroupDetail g = service.create(caller, req("대상" + UUID.randomUUID(), null, "PERSONAL"));
    assertThatThrownBy(
            () ->
                service.update(
                    caller,
                    g.id(),
                    new UpdateUserGroupRequest(null, parent.id(), true, null, null, null)))
        .isInstanceOf(InvalidUserGroupException.class);
    assertThatThrownBy(
            () ->
                service.update(
                    caller, g.id(), new UpdateUserGroupRequest(null, null, null, "C", true, null)))
        .isInstanceOf(InvalidUserGroupException.class);
  }

  @Test
  void update_renameOnly_checksSiblingNameUnderCurrentParent() {
    // 병합 후 값으로 유니크 검사 — 이름만 바꿔도 현재 부모 아래 형제와 겹치면 거절.
    long caller = user();
    UserGroupDetail parent =
        service.create(caller, req("부모" + UUID.randomUUID(), null, "PERSONAL"));
    String taken = "형제" + UUID.randomUUID();
    service.create(caller, req(taken, parent.id(), "PERSONAL"));
    UserGroupDetail target =
        service.create(caller, req("대상" + UUID.randomUUID(), parent.id(), "PERSONAL"));
    assertThatThrownBy(
            () ->
                service.update(
                    caller,
                    target.id(),
                    new UpdateUserGroupRequest(taken, null, null, null, null, null)))
        .isInstanceOf(InvalidUserGroupException.class);
  }

  @Test
  void create_duplicateSiblingName_shared_throwsInvalid() {
    long admin = user();
    makeAdmin(admin);
    String name = "중복부서" + UUID.randomUUID();
    service.create(admin, req(name, null, "SHARED"));
    assertThatThrownBy(() -> service.create(admin, req(name, null, "SHARED")))
        .isInstanceOf(InvalidUserGroupException.class);
  }

  @Test
  void create_duplicateName_shared_caseInsensitive_throwsInvalid() {
    long admin = user();
    makeAdmin(admin);
    String name = "CaseDup" + UUID.randomUUID();
    service.create(admin, req(name, null, "SHARED"));
    assertThatThrownBy(() -> service.create(admin, req(name.toLowerCase(), null, "SHARED")))
        .isInstanceOf(InvalidUserGroupException.class);
  }

  @Test
  void create_duplicateSharedCode_throwsInvalidWithKoreanMessage() {
    // WP-549: 공유 그룹 코드 중복은 DB 제약 위반(영어 409) 전에 한국어 안내로 거절한다.
    long admin = user();
    makeAdmin(admin);
    String code = "DUP-" + UUID.randomUUID();
    service.create(
        admin, new CreateUserGroupRequest("코드A" + UUID.randomUUID(), null, "SHARED", code, 0));
    assertThatThrownBy(
            () ->
                service.create(
                    admin,
                    new CreateUserGroupRequest("코드B" + UUID.randomUUID(), null, "SHARED", code, 0)))
        .isInstanceOf(InvalidUserGroupException.class)
        .hasMessageContaining("이미 존재하는 그룹 코드입니다");
  }

  @Test
  void update_toExistingSharedCode_throwsInvalid_keepingOwnCodeSucceeds() {
    long admin = user();
    makeAdmin(admin);
    String taken = "TAKEN-" + UUID.randomUUID();
    service.create(
        admin, new CreateUserGroupRequest("선점" + UUID.randomUUID(), null, "SHARED", taken, 0));
    String own = "OWN-" + UUID.randomUUID();
    UserGroupDetail target =
        service.create(
            admin, new CreateUserGroupRequest("대상" + UUID.randomUUID(), null, "SHARED", own, 0));
    assertThatThrownBy(
            () ->
                service.update(
                    admin,
                    target.id(),
                    new UpdateUserGroupRequest(null, null, null, taken, null, null)))
        .isInstanceOf(InvalidUserGroupException.class)
        .hasMessageContaining("이미 존재하는 그룹 코드입니다");
    // 자기 코드를 그대로 두고 이름만 바꾸는 수정은 통과한다.
    UserGroupDetail renamed =
        service.update(
            admin,
            target.id(),
            new UpdateUserGroupRequest("새이름" + UUID.randomUUID(), null, null, null, null, null));
    assertThat(renamed.code()).isEqualTo(own);
  }

  @Test
  void create_sameCode_personal_succeeds() {
    // 코드 유니크는 공유 그룹에만 있다 — 개인 그룹은 코드가 겹쳐도 된다.
    long caller = user();
    String code = "MINE-" + UUID.randomUUID();
    service.create(
        caller, new CreateUserGroupRequest("개인A" + UUID.randomUUID(), null, "PERSONAL", code, 0));
    UserGroupDetail g =
        service.create(
            caller,
            new CreateUserGroupRequest("개인B" + UUID.randomUUID(), null, "PERSONAL", code, 0));
    assertThat(g.code()).isEqualTo(code);
  }

  @Test
  void create_nameWithTrailingSpace_isDuplicateAndStoredTrimmed() {
    // WP-550: 끝 공백만 다른 이름은 같은 이름으로 보고, 저장도 앞뒤 공백을 다듬는다.
    long caller = user();
    String name = "협력사 담당자" + UUID.randomUUID();
    UserGroupDetail g = service.create(caller, req(" " + name + "  ", null, "PERSONAL"));
    assertThat(g.name()).isEqualTo(name);
    assertThatThrownBy(() -> service.create(caller, req(name + " ", null, "PERSONAL")))
        .isInstanceOf(InvalidUserGroupException.class);
    UserGroupDetail other = service.create(caller, req("다른" + UUID.randomUUID(), null, "PERSONAL"));
    assertThatThrownBy(
            () ->
                service.update(
                    caller,
                    other.id(),
                    new UpdateUserGroupRequest(name + " ", null, null, null, null, null)))
        .isInstanceOf(InvalidUserGroupException.class);
  }

  @Test
  void create_sameName_differentParent_succeeds() {
    long admin = user();
    makeAdmin(admin);
    String name = "동일이름" + UUID.randomUUID();
    UserGroupDetail parentA = service.create(admin, req("부모A" + UUID.randomUUID(), null, "SHARED"));
    UserGroupDetail parentB = service.create(admin, req("부모B" + UUID.randomUUID(), null, "SHARED"));
    service.create(admin, req(name, parentA.id(), "SHARED"));
    // 서로 다른 부모 아래에서는 동일 이름 허용
    UserGroupDetail g = service.create(admin, req(name, parentB.id(), "SHARED"));
    assertThat(g.name()).isEqualTo(name);
  }

  @Test
  void create_sameName_personalDifferentOwner_succeeds() {
    long a = user();
    long b = user();
    String name = "개인그룹" + UUID.randomUUID();
    service.create(a, req(name, null, "PERSONAL"));
    // 서로 다른 소유자의 개인 그룹은 최상위(parentId NULL)가 같아도 형제가 아니므로 허용
    UserGroupDetail g = service.create(b, req(name, null, "PERSONAL"));
    assertThat(g.name()).isEqualTo(name);
  }

  @Test
  void create_sameName_personalSameOwner_throwsInvalid() {
    long caller = user();
    String name = "내분류" + UUID.randomUUID();
    service.create(caller, req(name, null, "PERSONAL"));
    assertThatThrownBy(() -> service.create(caller, req(name, null, "PERSONAL")))
        .isInstanceOf(InvalidUserGroupException.class);
  }

  @Test
  void update_renameToExistingSiblingName_throwsInvalid() {
    long caller = user();
    String taken = "형제" + UUID.randomUUID();
    service.create(caller, req(taken, null, "PERSONAL"));
    UserGroupDetail target =
        service.create(caller, req("바꿀이름" + UUID.randomUUID(), null, "PERSONAL"));
    assertThatThrownBy(
            () ->
                service.update(
                    caller,
                    target.id(),
                    new UpdateUserGroupRequest(taken, null, null, null, null, null)))
        .isInstanceOf(InvalidUserGroupException.class);
  }

  @Test
  void update_keepingOwnName_succeeds() {
    long caller = user();
    String name = "그대로" + UUID.randomUUID();
    UserGroupDetail g = service.create(caller, req(name, null, "PERSONAL"));
    // 자기 자신의 이름으로 재저장 — excludeId 로 자기 자신은 제외되어 통과해야 함
    UserGroupDetail updated =
        service.update(
            caller, g.id(), new UpdateUserGroupRequest(name, null, null, null, null, null));
    assertThat(updated.name()).isEqualTo(name);
  }

  @Test
  void getDetail_personalByAdmin_returnsGroup() {
    long owner = user();
    long admin = user();
    makeAdmin(admin);
    UserGroupDetail g = service.create(owner, req("비공개", null, "PERSONAL"));
    UserGroupDetail seen = service.getDetail(admin, g.id());
    assertThat(seen.id()).isEqualTo(g.id());
  }

  /**
   * WP-677: 관리자라도 남의 개인 그룹을 다른 주인(자기)의 개인 그룹 밑으로 옮길 수 없다 — 옮기면 주인·관리자 트리 어디에도 안 보였다. 같은 주인의 개인 그룹
   * 밑으로는 옮길 수 있다.
   */
  @Test
  void update_adminMovesOthersPersonalUnderOwnPersonal_throwsInvalid_sameOwnerAllowed() {
    long owner = user();
    long admin = user();
    makeAdmin(admin);
    UserGroupDetail mine = service.create(owner, req("B의 개인그룹", null, "PERSONAL"));
    UserGroupDetail mine2 = service.create(owner, req("B의 다른 그룹", null, "PERSONAL"));
    UserGroupDetail adminGroup = service.create(admin, req("관리자 개인그룹", null, "PERSONAL"));

    assertThatThrownBy(
            () ->
                service.update(
                    admin,
                    mine.id(),
                    new UpdateUserGroupRequest(null, adminGroup.id(), null, null, null, null)))
        .isInstanceOf(InvalidUserGroupException.class)
        .hasMessage("같은 사람의 개인 그룹 밑으로만 옮길 수 있습니다");
    assertThat(service.getDetail(owner, mine.id()).parentId()).isNull();

    // 같은 주인(B)의 개인 그룹 밑으로는 관리자가 옮길 수 있다.
    service.update(
        admin, mine.id(), new UpdateUserGroupRequest(null, mine2.id(), null, null, null, null));
    assertThat(service.getDetail(owner, mine.id()).parentId()).isEqualTo(mine2.id());
  }

  /** WP-677: 관리자가 남의 개인 그룹을 그 그룹의 자손 밑으로 옮기는 순환도 막는다(자손은 주인의 트리로 판단). */
  @Test
  void update_adminMovesOthersPersonalUnderItsDescendant_throwsInvalid() {
    long owner = user();
    long admin = user();
    makeAdmin(admin);
    UserGroupDetail parent = service.create(owner, req("부모", null, "PERSONAL"));
    UserGroupDetail child = service.create(owner, req("자식", parent.id(), "PERSONAL"));

    assertThatThrownBy(
            () ->
                service.update(
                    admin,
                    parent.id(),
                    new UpdateUserGroupRequest(null, child.id(), null, null, null, null)))
        .isInstanceOf(InvalidUserGroupException.class)
        .hasMessage("그룹을 자손 그룹의 하위로 옮길 수 없습니다");
  }

  /** WP-677: 없는 부모·볼 수 없는 외부 연락처 오류 문구에 내부 id 가 남지 않는다(WP-672 후속). */
  @Test
  void errors_doNotExposeInternalIds() {
    long caller = user();
    long other = user();
    long privContact =
        dsl.insertInto(com.workplace.jooq.Tables.CONTACT_ENTRY)
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.NAME, "남의 연락처")
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.OWNER_ID, other)
            .set(com.workplace.jooq.Tables.CONTACT_ENTRY.VISIBILITY, "PERSONAL")
            .returning(com.workplace.jooq.Tables.CONTACT_ENTRY.ID)
            .fetchOne()
            .getId();
    UserGroupDetail g = service.create(caller, req("내 그룹", null, "PERSONAL"));
    assertThatThrownBy(
            () -> service.addMember(caller, g.id(), new AddMemberRequest("EXTERNAL", privContact)))
        .hasMessage("접근할 수 없는 외부 연락처입니다");
    assertThatThrownBy(() -> service.create(caller, req("고아", 987_654L, "PERSONAL")))
        .isInstanceOf(InvalidUserGroupException.class)
        .hasMessage("부모 그룹이 없습니다");
  }
}
