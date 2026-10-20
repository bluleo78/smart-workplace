package com.workplace.role.service;

import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.service.UserService;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-599 — ADMIN 이 아닌 사람은 자기가 가진 권한 안에서만 역할을 주고빼거나 역할의 권한을 바꿀 수 있다. role:assign 만 받은 구성원이 자기에게
 * ADMIN 을 주거나, role:write 만 받은 구성원이 자기 역할에 권한 전체를 넣어 관리자가 되던 권한 상승을 막는다.
 */
@Transactional
class RoleGrantEscalationTest extends IntegrationTestBase {

  private static final Long TENANT_ID = 1L;

  @Autowired private UserService userService;
  @Autowired private RoleService roleService;
  @Autowired private MembershipRepository membershipRepository;
  @Autowired private DSLContext dsl;

  private Long adminId;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
    adminId = insertMember("grant-admin@example.com");
    // WP-599: 역할을 주고빼는 사람은 그만한 권한이 있어야 한다 — 호출자를 ADMIN 으로 둔다.
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, adminId)
        .set(USER_ROLE.ROLE_ID, roleId("ADMIN"))
        .execute();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  void assigner_cannotGrantAdminToSelf() {
    Long assignerRole = customRole("ASSIGNER", "user:read", "role:assign");
    Long u2 = insertMember("grant-assigner@example.com");
    userService.setUserRoles(u2, List.of(assignerRole), adminId);

    assertThatThrownBy(
            () -> userService.setUserRoles(u2, List.of(roleId("ADMIN"), assignerRole), u2))
        .isInstanceOf(AccessDeniedException.class)
        .hasMessage("자신에게 없는 권한이 담긴 역할은 주거나 뺄 수 없습니다");
    assertThat(roleNames(u2)).containsExactly("ASSIGNER");
  }

  @Test
  void assigner_canGrantRoleWithinOwnPermissions_butCannotStripStrongerRole() {
    Long assignerRole = customRole("ASSIGNER", "user:read", "role:assign");
    Long viewerRole = customRole("VIEWER", "user:read");
    Long u2 = insertMember("grant-assigner2@example.com");
    Long u3 = insertMember("grant-target@example.com");
    Long admin2 = insertMember("grant-admin2@example.com");
    userService.setUserRoles(u2, List.of(assignerRole), adminId);
    userService.setUserRoles(admin2, List.of(roleId("ADMIN")), adminId);

    userService.setUserRoles(u3, List.of(viewerRole), u2);
    assertThat(roleNames(u3)).containsExactly("VIEWER");

    // 자기보다 강한 역할(ADMIN)을 남에게서 빼는 것도 같은 기준으로 막는다.
    assertThatThrownBy(() -> userService.setUserRoles(admin2, List.of(), u2))
        .isInstanceOf(AccessDeniedException.class);
  }

  @Test
  void roleWriter_cannotAddPermissionsTheyLack() {
    Long writerRole = customRole("WRITER", "role:read", "role:write");
    Long otherRole = customRole("OTHER");
    Long u4 = insertMember("grant-writer@example.com");
    userService.setUserRoles(u4, List.of(writerRole), adminId);

    List<Long> all = dsl.select(PERMISSION.ID).from(PERMISSION).fetch(PERMISSION.ID);
    assertThatThrownBy(() -> roleService.setRolePermissions(writerRole, all, u4))
        .isInstanceOf(AccessDeniedException.class)
        .hasMessage("자신에게 없는 권한은 역할에 넣거나 뺄 수 없습니다");

    // 자기 권한 안이면 된다.
    roleService.setRolePermissions(otherRole, List.of(permissionId("role:read")), u4);
  }

  @Test
  void admin_isNotLimited() {
    Long u5 = insertMember("grant-plain@example.com");
    userService.setUserRoles(u5, List.of(roleId("ADMIN")), adminId);
    Long r = customRole("ANY");
    List<Long> all = dsl.select(PERMISSION.ID).from(PERMISSION).fetch(PERMISSION.ID);
    roleService.setRolePermissions(r, all, adminId);
  }

  private Long customRole(String name, String... codes) {
    Long id = roleService.createRole(name, null, adminId).id();
    List<Long> ids = java.util.Arrays.stream(codes).map(this::permissionId).toList();
    if (!ids.isEmpty()) roleService.setRolePermissions(id, ids, adminId);
    return id;
  }

  private Long permissionId(String code) {
    return dsl.select(PERMISSION.ID)
        .from(PERMISSION)
        .where(PERMISSION.CODE.eq(code))
        .fetchOne(PERMISSION.ID);
  }

  private Long roleId(String name) {
    return dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(name)).fetchOne(ROLE.ID);
  }

  private List<String> roleNames(Long userId) {
    return dsl.select(ROLE.NAME)
        .from(ROLE)
        .join(com.workplace.jooq.Tables.USER_ROLE)
        .on(com.workplace.jooq.Tables.USER_ROLE.ROLE_ID.eq(ROLE.ID))
        .where(com.workplace.jooq.Tables.USER_ROLE.USER_ID.eq(userId))
        .fetch(ROLE.NAME);
  }

  private Long insertMember(String username) {
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, username)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, username)
            .set(USER.EMAIL, username)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    membershipRepository.create(id, TENANT_ID, "ACTIVE");
    return id;
  }
}
