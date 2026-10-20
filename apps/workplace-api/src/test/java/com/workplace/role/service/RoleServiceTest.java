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
    // WP-571: 문구에 요청한 id 를 되돌려 싣지 않는다.
    assertThatThrownBy(() -> roleService.getRoleById(Long.MAX_VALUE))
        .isInstanceOf(RoleNotFoundException.class)
        .hasMessage("역할을 찾을 수 없습니다");
  }

  @Test
  void createRole_success() {
    RoleResponse result = roleService.createRole("MODERATOR", "Moderator role", null);

    assertThat(result.id()).isNotNull();
    assertThat(result.name()).isEqualTo("MODERATOR");
    assertThat(result.description()).isEqualTo("Moderator role");
  }

  @Test
  void createRole_duplicateName_throwsException() {
    assertThatThrownBy(() -> roleService.createRole("ADMIN", "Duplicate", null))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("이미 존재하는 역할 이름입니다");
  }

  @Test
  void updateRole_success() {
    RoleResponse created = roleService.createRole("MODERATOR", "Moderator", null);

    roleService.updateRole(created.id(), "MOD", "Updated moderator", null);

    RoleDetailResponse updated = roleService.getRoleById(created.id());
    assertThat(updated.name()).isEqualTo("MOD");
    assertThat(updated.description()).isEqualTo("Updated moderator");
  }

  @Test
  void updateRole_duplicateName_throwsException() {
    // #795: 커스텀 역할 이름 변경 시 다른 커스텀 역할과 이름이 겹치면 DB unique 제약이 아니라
    // createRole 과 동일한 사전 검사로 친화적 예외가 발생해야 한다.
    roleService.createRole("EXISTING_ROLE", "Existing role", null);
    RoleResponse target = roleService.createRole("TARGET_ROLE", "Target role", null);

    assertThatThrownBy(() -> roleService.updateRole(target.id(), "EXISTING_ROLE", "Renamed", null))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("이미 존재하는 역할 이름입니다");
  }

  @Test
  void updateRole_renameToExistingSystemRoleName_throwsException() {
    // #795: 시스템 역할 이름(ADMIN)으로 변경 시도해도 동일하게 사전 검사에서 걸러져야 한다.
    RoleResponse target = roleService.createRole("TARGET_ROLE2", "Target role 2", null);

    assertThatThrownBy(() -> roleService.updateRole(target.id(), "ADMIN", "Renamed", null))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("이미 존재하는 역할 이름입니다");
  }

  @Test
  void updateRole_sameName_doesNotThrow() {
    // #795: 이름을 변경하지 않고 설명만 바꾸는 경우엔 중복검사에 걸리면 안 된다 (자기 자신 제외).
    RoleResponse created = roleService.createRole("UNCHANGED_ROLE", "Original description", null);

    roleService.updateRole(created.id(), "UNCHANGED_ROLE", "Updated description", null);

    RoleDetailResponse updated = roleService.getRoleById(created.id());
    assertThat(updated.description()).isEqualTo("Updated description");
  }

  @Test
  void updateRole_systemRole_throwsException() {
    Long adminRoleId =
        dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);

    assertThatThrownBy(() -> roleService.updateRole(adminRoleId, "RENAMED", "Try rename", null))
        .isInstanceOf(SystemRoleModificationException.class)
        .hasMessage("시스템 역할의 이름은 바꿀 수 없습니다");
  }

  @Test
  void deleteRole_success() {
    RoleResponse created = roleService.createRole("MODERATOR", "Moderator", null);

    roleService.deleteRole(created.id(), null);

    assertThatThrownBy(() -> roleService.getRoleById(created.id()))
        .isInstanceOf(RoleNotFoundException.class);
  }

  @Test
  void deleteRole_assignedToUser_throwsRoleAssignedException() {
    // #678: 역할이 사용자에게 할당된 상태에서 삭제 시도 → user_role CASCADE 로 조용히
    // 권한이 사라지는 것을 방지하기 위해 하드 차단해야 한다.
    RoleResponse created = roleService.createRole("ASSIGNED_ROLE", "Assigned role", null);
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

    assertThatThrownBy(() -> roleService.deleteRole(created.id(), null))
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

    assertThatThrownBy(() -> roleService.deleteRole(adminRoleId, null))
        .isInstanceOf(SystemRoleModificationException.class)
        .hasMessage("시스템 역할은 삭제할 수 없습니다");
  }

  @Test
  void setRolePermissions_customRole_success() {
    RoleResponse customRole = roleService.createRole("CUSTOM_ROLE", "Custom role for test", null);

    List<Long> permissionIds =
        dsl.select(PERMISSION.ID)
            .from(PERMISSION)
            .where(PERMISSION.CATEGORY.eq("user"))
            .fetch(PERMISSION.ID);

    roleService.setRolePermissions(customRole.id(), permissionIds, null);

    RoleDetailResponse detail = roleService.getRoleById(customRole.id());
    assertThat(detail.permissions()).hasSize(permissionIds.size());
  }

  @Test
  void setRolePermissions_unknownPermission_isRejectedInKorean() {
    // WP-570: 없는 권한 id 가 FK 위반 → 영어 409 로 새던 결함 — 저장 전에 한국어 400 으로 거절한다.
    RoleResponse role = roleService.createRole("UNKNOWN_PERM_ROLE", "x", null);

    assertThatThrownBy(() -> roleService.setRolePermissions(role.id(), List.of(999_999L), null))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("없는 권한이 포함되어 있습니다");
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

    assertThatThrownBy(() -> roleService.setRolePermissions(adminRoleId, permissionIds, null))
        .isInstanceOf(SystemRoleModificationException.class)
        .hasMessage("시스템 역할의 권한은 변경할 수 없습니다");
  }
}
