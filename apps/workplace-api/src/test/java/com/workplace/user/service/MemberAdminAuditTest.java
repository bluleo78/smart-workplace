package com.workplace.user.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.audit.dto.AuditLogResponse;
import com.workplace.audit.service.AuditLogService;
import com.workplace.global.security.AuthDetails;
import com.workplace.global.tenant.TenantContext;
import com.workplace.role.dto.RoleResponse;
import com.workplace.role.service.RoleService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-567 — 권한 상승·접근 차단을 나중에 추적할 수 있도록 구성원 역할 변경(ADMIN 부여 포함)·정지·복구·비밀번호 변경과 역할 생성·수정·삭제·권한 변경이
 * 행위자·대상과 함께 감사 로그에 남아야 한다.
 */
@Transactional
class MemberAdminAuditTest extends IntegrationTestBase {

  // V44 가 시드하는 기본 테넌트(id=1, ACTIVE).
  private static final Long TENANT_ID = 1L;

  @Autowired private UserService userService;
  @Autowired private RoleService roleService;
  @Autowired private AuditLogService auditLogService;
  @Autowired private PasswordEncoder passwordEncoder;
  @Autowired private MembershipRepository membershipRepository;
  @Autowired private DSLContext dsl;

  private Long adminId;
  private Long targetId;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
    adminId = insertMember("audit-admin@example.com");
    targetId = insertMember("audit-target@example.com");
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private Long insertMember(String username) {
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, username)
            .set(USER.PASSWORD, passwordEncoder.encode("Password123"))
            .set(USER.NAME, username)
            .set(USER.EMAIL, username)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    membershipRepository.create(id, TENANT_ID, "ACTIVE");
    return id;
  }

  private Long roleId(String name) {
    return dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(name)).fetchOne(ROLE.ID);
  }

  private List<AuditLogResponse> logs(String actionType, String resource, Object resourceId) {
    return auditLogService.findByResource(actionType, resource, String.valueOf(resourceId));
  }

  @Test
  void setUserRoles_recordsBeforeAndAfter() {
    userService.setUserRoles(targetId, List.of(roleId("USER")), adminId);
    userService.setUserRoles(targetId, List.of(roleId("ADMIN"), roleId("USER")), adminId);

    // 같은 트랜잭션이라 시각이 같아 순서를 기대하지 않는다 — ADMIN 부여 기록이 행위자·대상·전후 역할과 함께 있는지만 본다.
    List<AuditLogResponse> logs = logs("MEMBER_ROLES_CHANGED", "user", targetId);
    assertThat(logs).hasSize(2);
    assertThat(logs)
        .anySatisfy(
            l -> {
              assertThat(l.userId()).isEqualTo(adminId);
              assertThat(l.description())
                  .contains("audit-target@example.com")
                  .contains("USER → ADMIN, USER");
              assertThat(l.metadata()).contains("ADMIN,USER");
            });
  }

  @Test
  void setUserRolesByNames_isRecordedToo() {
    // AI 확인카드 경로(역할명) — 같은 기록을 남긴다.
    userService.setUserRolesByNames(targetId, List.of("ADMIN", "USER"), adminId);

    assertThat(logs("MEMBER_ROLES_CHANGED", "user", targetId)).isNotEmpty();
  }

  @Test
  void setUserActive_recordsSuspendAndReactivate_onlyOnRealTransition() {
    userService.setUserActive(targetId, false, adminId);
    // 이미 정지된 멤버를 다시 끄는 멱등 호출은 기록하지 않는다.
    userService.setUserActive(targetId, false, adminId);
    userService.setUserActive(targetId, true, adminId);

    List<AuditLogResponse> suspended = logs("MEMBER_SUSPENDED", "user", targetId);
    assertThat(suspended).hasSize(1);
    assertThat(suspended.get(0).userId()).isEqualTo(adminId);
    assertThat(logs("MEMBER_REACTIVATED", "user", targetId)).hasSize(1);
  }

  @Test
  void changePassword_isRecordedAsSelf() {
    userService.changePassword(targetId, "Password123", "Password456", AuthDetails.PASSWORD);

    List<AuditLogResponse> logs = logs("PASSWORD_CHANGED", "user", targetId);
    assertThat(logs).hasSize(1);
    assertThat(logs.get(0).userId()).isEqualTo(targetId);
  }

  @Test
  void roleLifecycle_isRecorded() {
    RoleResponse role = roleService.createRole("AUDIT_ROLE", "감사 확인용", adminId);
    roleService.updateRole(role.id(), "AUDIT_ROLE2", "이름 바꿈", adminId);
    Long permissionId = dsl.select(PERMISSION.ID).from(PERMISSION).limit(1).fetchOne(PERMISSION.ID);
    roleService.setRolePermissions(role.id(), List.of(permissionId), adminId);
    roleService.deleteRole(role.id(), adminId);

    for (String action :
        List.of("ROLE_CREATED", "ROLE_UPDATED", "ROLE_PERMISSIONS_CHANGED", "ROLE_DELETED")) {
      List<AuditLogResponse> logs = logs(action, "role", role.id());
      assertThat(logs).as(action).hasSize(1);
      assertThat(logs.get(0).userId()).as(action).isEqualTo(adminId);
    }
  }
}
