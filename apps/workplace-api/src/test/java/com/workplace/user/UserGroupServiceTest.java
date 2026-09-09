package com.workplace.user;

import static com.workplace.jooq.Tables.ROLE;
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
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "u_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "User " + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .set(USER.IS_ACTIVE, true)
        .returning(USER.ID)
        .fetchOne()
        .getId();
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
            () -> service.update(plain, g.id(), new UpdateUserGroupRequest("수정", null, null, 0)))
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
                    caller, parent.id(), new UpdateUserGroupRequest("부모", child.id(), null, 0)))
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
        service.update(caller, child.id(), new UpdateUserGroupRequest("자식", null, null, 0));
    assertThat(updated.parentId()).isNull();
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
                    caller, target.id(), new UpdateUserGroupRequest(taken, null, null, 0)))
        .isInstanceOf(InvalidUserGroupException.class);
  }

  @Test
  void update_keepingOwnName_succeeds() {
    long caller = user();
    String name = "그대로" + UUID.randomUUID();
    UserGroupDetail g = service.create(caller, req(name, null, "PERSONAL"));
    // 자기 자신의 이름으로 재저장 — excludeId 로 자기 자신은 제외되어 통과해야 함
    UserGroupDetail updated =
        service.update(caller, g.id(), new UpdateUserGroupRequest(name, null, null, 0));
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
}
