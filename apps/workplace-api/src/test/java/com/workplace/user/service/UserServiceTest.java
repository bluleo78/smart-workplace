package com.workplace.user.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.exception.EmailAlreadyExistsException;
import com.workplace.global.dto.PageResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.AgentResponse;
import com.workplace.user.dto.UserDetailResponse;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.UserNotFoundException;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class UserServiceTest extends IntegrationTestBase {

  // V44 가 시드하는 기본 테넌트(id=1, ACTIVE). 사용자 목록은 active 테넌트로 스코프된다.
  private static final Long TENANT_ID = 1L;

  @Autowired private UserService userService;

  @Autowired private PasswordEncoder passwordEncoder;

  @Autowired private MembershipRepository membershipRepository;

  @Autowired private DSLContext dsl;

  private Long testUserId;

  @BeforeEach
  void setUp() {
    // 사용자 목록 조회는 인증된 ADMIN 요청이라 active 테넌트가 항상 존재한다 — 테스트에서도 시뮬레이트.
    TenantContext.set(TENANT_ID);
    testUserId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "testuser@example.com")
            .set(USER.PASSWORD, passwordEncoder.encode("Password123"))
            .set(USER.NAME, "Test User")
            .set(USER.EMAIL, "test@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // testUser 를 active 테넌트 멤버로 귀속 — 목록에 노출되려면 멤버십이 있어야 한다.
    membershipRepository.create(testUserId, TENANT_ID, "ACTIVE");
  }

  @AfterEach
  void clearTenant() {
    // ThreadLocal 누수 방지 — 공유 스레드에 테넌트가 남으면 후속 테스트 클래스에 오염된다.
    TenantContext.clear();
  }

  @Test
  void getUsers_returnsPaginatedResults() {
    PageResponse<UserResponse> result = userService.getUsers("testuser@example.com", 0, 20);

    assertThat(result.content()).hasSizeGreaterThanOrEqualTo(1);
    assertThat(result.content().stream().anyMatch(u -> u.username().equals("testuser@example.com")))
        .isTrue();
    assertThat(result.page()).isEqualTo(0);
    assertThat(result.size()).isEqualTo(20);
  }

  @Test
  void getUsers_excludesOtherTenantMembers() {
    // 동일 검색어를 갖는 두 사용자를 서로 다른 테넌트에 배치 → active 테넌트(1) 멤버만 반환되어야 한다.
    // 전역(스코프 없는) 쿼리라면 둘 다 반환되어 이 테스트가 실패한다 — 테넌트 격리의 핵심 가드.
    String tag = "scopetag-" + System.nanoTime();
    Long inTenant1 = seedUser(tag + "-a@example.com", tag);
    membershipRepository.create(inTenant1, TENANT_ID, "ACTIVE");

    Long otherTenant =
        dsl.insertInto(TENANT)
            .set(TENANT.SLUG, "t2-" + System.nanoTime())
            .set(TENANT.NAME, "Tenant 2")
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();
    Long inTenant2 = seedUser(tag + "-b@example.com", tag);
    membershipRepository.create(inTenant2, otherTenant, "ACTIVE");

    PageResponse<UserResponse> result = userService.getUsers(tag, 0, 20);
    List<Long> ids = result.content().stream().map(UserResponse::id).toList();

    assertThat(ids).contains(inTenant1);
    assertThat(ids).doesNotContain(inTenant2);
  }

  @Test
  void listByKind_excludesOtherTenantAgents() {
    // AGENT 목록(AGENT 관리 화면)도 active 테넌트로 스코프된다 — 다른 테넌트 AGENT 누출 방지.
    Long agentT1 = seedAgent("agent-t1-" + System.nanoTime());
    membershipRepository.create(agentT1, TENANT_ID, "ACTIVE");

    Long otherTenant =
        dsl.insertInto(TENANT)
            .set(TENANT.SLUG, "t3-" + System.nanoTime())
            .set(TENANT.NAME, "Tenant 3")
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();
    Long agentT2 = seedAgent("agent-t2-" + System.nanoTime());
    membershipRepository.create(agentT2, otherTenant, "ACTIVE");

    List<UserResponse> agents = userService.listByKind("AGENT");
    List<Long> ids = agents.stream().map(UserResponse::id).toList();

    assertThat(ids).contains(agentT1);
    assertThat(ids).doesNotContain(agentT2);
  }

  @Test
  void listAgents_excludesPersonalAssistantsByDefault_includesWhenRequested() {
    // 워크스페이스 에이전트(관리자 생성) 1개 + 개인 비서 형태(__assistant_u*) 1개를 같은 테넌트에 시드.
    long nano = System.nanoTime();
    Long workspaceAgent = seedAgent("ws-agent-" + nano);
    membershipRepository.create(workspaceAgent, TENANT_ID, "ACTIVE");
    Long personalAgent = seedAgent("__assistant_u" + nano);
    membershipRepository.create(personalAgent, TENANT_ID, "ACTIVE");
    // testUser 를 personalAgent 의 소유자로 연결 → ownerName 검증.
    dsl.update(USER)
        .set(USER.PERSONAL_ASSISTANT_AGENT_ID, personalAgent)
        .where(USER.ID.eq(testUserId))
        .execute();

    // 기본(includePersonal=false): 개인 비서는 제외, 워크스페이스 에이전트만.
    List<Long> defaultIds = userService.listAgents(false).stream().map(AgentResponse::id).toList();
    assertThat(defaultIds).contains(workspaceAgent);
    assertThat(defaultIds).doesNotContain(personalAgent);

    // includePersonal=true: 둘 다 포함 + 유형/소유자 분류.
    List<AgentResponse> all = userService.listAgents(true);
    assertThat(all.stream().map(AgentResponse::id).toList())
        .contains(workspaceAgent, personalAgent);

    AgentResponse personal =
        all.stream().filter(a -> a.id().equals(personalAgent)).findFirst().orElseThrow();
    assertThat(personal.type()).isEqualTo(AgentResponse.TYPE_PERSONAL);
    assertThat(personal.ownerName()).isEqualTo("Test User");

    AgentResponse workspace =
        all.stream().filter(a -> a.id().equals(workspaceAgent)).findFirst().orElseThrow();
    assertThat(workspace.type()).isEqualTo(AgentResponse.TYPE_REGULAR);
    assertThat(workspace.ownerName()).isNull();
  }

  /** 검색 가능한 이름(tag)을 가진 HUMAN 사용자 시드. */
  private Long seedUser(String email, String name) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, email)
        .set(USER.PASSWORD, passwordEncoder.encode("Password123"))
        .set(USER.NAME, name)
        .set(USER.EMAIL, email)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** kind='AGENT' 사용자 시드. */
  private Long seedAgent(String username) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.NAME, username)
        .set(USER.EMAIL, username + "@example.com")
        .set(USER.KIND, "AGENT")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void getUserById_returnsUserWithRoles() {
    Long adminRoleId =
        dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);

    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, testUserId)
        .set(USER_ROLE.ROLE_ID, adminRoleId)
        .execute();

    UserDetailResponse result = userService.getUserById(testUserId);

    assertThat(result.id()).isEqualTo(testUserId);
    assertThat(result.username()).isEqualTo("testuser@example.com");
    assertThat(result.roles()).hasSize(1);
    assertThat(result.roles().get(0).name()).isEqualTo("ADMIN");
  }

  @Test
  void getUserById_notFound_throwsException() {
    assertThatThrownBy(() -> userService.getUserById(Long.MAX_VALUE))
        .isInstanceOf(UserNotFoundException.class);
  }

  @Test
  void updateProfile_success() {
    userService.updateProfile(testUserId, "New Name", "new@example.com");

    UserDetailResponse updated = userService.getUserById(testUserId);
    assertThat(updated.name()).isEqualTo("New Name");
    assertThat(updated.email()).isEqualTo("new@example.com");
  }

  @Test
  void updateProfile_emailConflict_throwsException() {
    dsl.insertInto(USER)
        .set(USER.USERNAME, "otheruser@example.com")
        .set(USER.PASSWORD, "password")
        .set(USER.NAME, "Other User")
        .set(USER.EMAIL, "taken@example.com")
        .execute();

    assertThatThrownBy(() -> userService.updateProfile(testUserId, "New Name", "taken@example.com"))
        .isInstanceOf(EmailAlreadyExistsException.class);
  }

  @Test
  void changePassword_success() {
    userService.changePassword(testUserId, "Password123", "newpassword");

    String storedPassword =
        dsl.select(USER.PASSWORD).from(USER).where(USER.ID.eq(testUserId)).fetchOne(USER.PASSWORD);
    assertThat(passwordEncoder.matches("newpassword", storedPassword)).isTrue();
  }

  @Test
  void changePassword_wrongCurrentPassword_throwsException() {
    // 현재 비밀번호 불일치 → 400 Bad Request를 위한 IllegalArgumentException (#27)
    assertThatThrownBy(() -> userService.changePassword(testUserId, "wrongpass", "newpass"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("현재 비밀번호가 올바르지 않습니다");
  }

  @Test
  void setUserRoles_success() {
    Long adminRoleId =
        dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);

    Long userRoleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);

    // callerId를 testUserId와 다르게 설정하여 자기 자신 역할 제거 보호 로직 비활성화
    userService.setUserRoles(testUserId, List.of(adminRoleId, userRoleId), testUserId + 1000);

    UserDetailResponse detail = userService.getUserById(testUserId);
    assertThat(detail.roles()).hasSize(2);
  }

  @Test
  void setUserActive_success() {
    // 일반 유저(ADMIN 아님) 비활성화는 정상 동작
    userService.setUserActive(testUserId, false);

    UserDetailResponse detail = userService.getUserById(testUserId);
    assertThat(detail.isActive()).isFalse();
  }

  @Test
  void setUserActive_lastAdmin_throwsException() {
    // 유일한 활성 ADMIN 계정을 비활성화하면 IllegalStateException (#146)
    Long adminRoleId =
        dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);

    // testUserId에게 ADMIN 역할 부여
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, testUserId)
        .set(USER_ROLE.ROLE_ID, adminRoleId)
        .execute();

    // 시스템에 활성 ADMIN이 testUserId 하나뿐인 상태에서 비활성화 시도
    // (setUp의 testUserId 외 다른 ADMIN이 없는 경우를 가정 — IntegrationTestBase 격리 환경)
    assertThatThrownBy(() -> userService.setUserActive(testUserId, false))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("마지막 활성 ADMIN");
  }

  @Test
  void setUserActive_lastAdmin_allowActivation() {
    // 비활성 ADMIN을 다시 활성화하는 것은 항상 허용
    Long adminRoleId =
        dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);

    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, testUserId)
        .set(USER_ROLE.ROLE_ID, adminRoleId)
        .execute();

    // 먼저 다른 ADMIN을 하나 더 만들어 비활성화 가능 상태로
    Long adminUserId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "admin2@example.com")
            .set(USER.PASSWORD, passwordEncoder.encode("Password123"))
            .set(USER.NAME, "Admin 2")
            .set(USER.EMAIL, "admin2@example.com")
            .set(USER.IS_ACTIVE, false)
            .returning(USER.ID)
            .fetchOne()
            .getId();

    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, adminUserId)
        .set(USER_ROLE.ROLE_ID, adminRoleId)
        .execute();

    // 비활성 ADMIN 계정 활성화 — 예외 없이 성공해야 함
    userService.setUserActive(adminUserId, true);

    UserDetailResponse detail = userService.getUserById(adminUserId);
    assertThat(detail.isActive()).isTrue();
  }

  @Test
  void setUserActive_multipleAdmins_allowDeactivation() {
    // 활성 ADMIN이 2명 이상이면 한 명 비활성화 허용 (#146)
    Long adminRoleId =
        dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);

    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, testUserId)
        .set(USER_ROLE.ROLE_ID, adminRoleId)
        .execute();

    Long secondAdminId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "admin3@example.com")
            .set(USER.PASSWORD, passwordEncoder.encode("Password123"))
            .set(USER.NAME, "Admin 3")
            .set(USER.EMAIL, "admin3@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();

    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, secondAdminId)
        .set(USER_ROLE.ROLE_ID, adminRoleId)
        .execute();

    // 2명의 활성 ADMIN 중 한 명 비활성화 — 예외 없이 성공해야 함
    userService.setUserActive(testUserId, false);

    UserDetailResponse detail = userService.getUserById(testUserId);
    assertThat(detail.isActive()).isFalse();
  }
}
