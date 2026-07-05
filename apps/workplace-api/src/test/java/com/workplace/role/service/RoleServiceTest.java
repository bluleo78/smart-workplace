package com.workplace.role.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.role.dto.RoleDetailResponse;
import com.workplace.role.dto.RoleResponse;
import com.workplace.role.exception.RoleAssignedException;
import com.workplace.role.exception.RoleNotFoundException;
import com.workplace.role.exception.SystemRoleModificationException;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class RoleServiceTest extends IntegrationTestBase {

  @Autowired private RoleService roleService;

  @Autowired private DSLContext dsl;

  @Test
  void getAllRoles_returnsList() {
    List<RoleResponse> result = roleService.getAllRoles();

    assertThat(result).hasSizeGreaterThanOrEqualTo(2);
    assertThat(result).anyMatch(r -> r.name().equals("ADMIN"));
    assertThat(result).anyMatch(r -> r.name().equals("USER"));
  }

  @Test
  void getRoleById_returnsRoleWithPermissions() {
    Long adminRoleId =
        dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);

    RoleDetailResponse result = roleService.getRoleById(adminRoleId);

    assertThat(result.name()).isEqualTo("ADMIN");
    assertThat(result.permissions()).isNotEmpty();
  }

  @Test
  void getRoleById_notFound_throwsException() {
    assertThatThrownBy(() -> roleService.getRoleById(Long.MAX_VALUE))
        .isInstanceOf(RoleNotFoundException.class);
  }

  @Test
  void createRole_success() {
    RoleResponse result = roleService.createRole("MODERATOR", "Moderator role");

    assertThat(result.id()).isNotNull();
    assertThat(result.name()).isEqualTo("MODERATOR");
    assertThat(result.description()).isEqualTo("Moderator role");
  }

  @Test
  void createRole_duplicateName_throwsException() {
    assertThatThrownBy(() -> roleService.createRole("ADMIN", "Duplicate"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("이미 존재하는 역할 이름입니다");
  }

  @Test
  void updateRole_success() {
    RoleResponse created = roleService.createRole("MODERATOR", "Moderator");

    roleService.updateRole(created.id(), "MOD", "Updated moderator");

    RoleDetailResponse updated = roleService.getRoleById(created.id());
    assertThat(updated.name()).isEqualTo("MOD");
    assertThat(updated.description()).isEqualTo("Updated moderator");
  }

  @Test
  void updateRole_systemRole_throwsException() {
    Long adminRoleId =
        dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);

    assertThatThrownBy(() -> roleService.updateRole(adminRoleId, "RENAMED", "Try rename"))
        .isInstanceOf(SystemRoleModificationException.class);
  }

  @Test
  void deleteRole_success() {
    RoleResponse created = roleService.createRole("MODERATOR", "Moderator");

    roleService.deleteRole(created.id());

    assertThatThrownBy(() -> roleService.getRoleById(created.id()))
        .isInstanceOf(RoleNotFoundException.class);
  }

  @Test
  void deleteRole_assignedToUser_throwsRoleAssignedException() {
    // #678: 역할이 사용자에게 할당된 상태에서 삭제 시도 → user_role CASCADE 로 조용히
    // 권한이 사라지는 것을 방지하기 위해 하드 차단해야 한다.
    RoleResponse created = roleService.createRole("ASSIGNED_ROLE", "Assigned role");
    Long assigneeId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "role678-assignee@example.com")
            .set(USER.NAME, "Role Assignee")
            .set(USER.EMAIL, "role678-assignee@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, assigneeId)
        .set(USER_ROLE.ROLE_ID, created.id())
        .execute();

    assertThatThrownBy(() -> roleService.deleteRole(created.id()))
        .isInstanceOf(RoleAssignedException.class)
        .hasMessageContaining("1")
        .hasMessageContaining("ASSIGNED_ROLE");

    // 차단되었으므로 역할과 할당 둘 다 그대로 남아있어야 한다.
    assertThat(roleService.getRoleById(created.id())).isNotNull();
  }

  @Test
  void deleteRole_systemRole_throwsException() {
    Long adminRoleId =
        dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);

    assertThatThrownBy(() -> roleService.deleteRole(adminRoleId))
        .isInstanceOf(SystemRoleModificationException.class);
  }

  @Test
  void setRolePermissions_customRole_success() {
    RoleResponse customRole = roleService.createRole("CUSTOM_ROLE", "Custom role for test");

    List<Long> permissionIds =
        dsl.select(PERMISSION.ID)
            .from(PERMISSION)
            .where(PERMISSION.CATEGORY.eq("user"))
            .fetch(PERMISSION.ID);

    roleService.setRolePermissions(customRole.id(), permissionIds);

    RoleDetailResponse detail = roleService.getRoleById(customRole.id());
    assertThat(detail.permissions()).hasSize(permissionIds.size());
  }

  @Test
  void setRolePermissions_systemRole_throwsException() {
    Long adminRoleId =
        dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);

    List<Long> permissionIds =
        dsl.select(PERMISSION.ID)
            .from(PERMISSION)
            .where(PERMISSION.CATEGORY.eq("user"))
            .fetch(PERMISSION.ID);

    assertThatThrownBy(() -> roleService.setRolePermissions(adminRoleId, permissionIds))
        .isInstanceOf(SystemRoleModificationException.class)
        .hasMessageContaining("Cannot modify permissions of system role");
  }
}
