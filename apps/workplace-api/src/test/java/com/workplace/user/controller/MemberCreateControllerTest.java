package com.workplace.user.controller;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.service.AuthService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.CreateMemberRequest;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 테넌트 ADMIN 의 구성원(계정) 생성 통합 테스트(고객 콘솔 셀프서비스).
 *
 * <p>⭐ 실제 JWT 토큰 경로를 쓴다(post-processor 아님). createMember 가 TenantContext.get() 에 의존하므로, 필터가 토큰의
 * tenant 클레임으로 TenantContext+GUC 를 주입해야 한다. 권한도 DB(user_role+role_permission)에서 실제 조회되므로 ADMIN 역할을
 * 시드한다(ADMIN=전체 권한, V2 시드).
 */
@AutoConfigureMockMvc
@Transactional
class MemberCreateControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper objectMapper;
  @Autowired AuthService authService;
  @Autowired JwtTokenProvider jwtTokenProvider;

  private static final Long TENANT_ID = 1L; // application-test.yml 의 기본 테넌트

  /** HUMAN 사용자 + 지정 역할(role_name) 시드 → userId. user_role 은 ambient GUC(=1)로 tenant 1 에 귀속. */
  private Long seedUserWithRole(String prefix, String roleName) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(roleName)).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  /** tenant 1 스코프 액세스 토큰(필터가 TenantContext(1)+권한 주입). */
  private String tokenFor(Long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "tester", TENANT_ID);
  }

  @Test
  void createMember_asAdmin_createsAccountMembershipRole_andCanLogin() throws Exception {
    String adminAuth = tokenFor(seedUserWithRole("admin", "ADMIN"));
    String username = "jane-" + UUID.randomUUID().toString().substring(0, 8);
    String json =
        objectMapper.writeValueAsString(
            new CreateMemberRequest(username, "jane@acme.com", "김제인", "Password123", "USER"));

    // when: 구성원 생성 → 201
    mvc.perform(
            post("/api/v1/users")
                .header("Authorization", adminAuth)
                .contentType("application/json")
                .content(json))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.username").value(username))
        .andExpect(jsonPath("$.email").value("jane@acme.com"))
        .andExpect(jsonPath("$.role").value("USER"))
        .andExpect(jsonPath("$.status").value("ACTIVE"));

    // then: 계정/멤버십/RBAC 역할이 단일 트랜잭션으로 생성됨
    Long newId = dsl.select(USER.ID).from(USER).where(USER.USERNAME.eq(username)).fetchOne(USER.ID);
    assertThat(newId).isNotNull();
    int memberships =
        dsl.fetchCount(
            dsl.selectFrom(MEMBERSHIP)
                .where(MEMBERSHIP.USER_ID.eq(newId))
                .and(MEMBERSHIP.TENANT_ID.eq(TENANT_ID)));
    assertThat(memberships).isEqualTo(1);
    Long assignedRole =
        dsl.select(USER_ROLE.ROLE_ID)
            .from(USER_ROLE)
            .where(USER_ROLE.USER_ID.eq(newId))
            .fetchOne(USER_ROLE.ROLE_ID);
    Long userRoleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    assertThat(assignedRole).isEqualTo(userRoleId);

    // then(end-to-end): 생성 계정으로 로그인 성공(아이디=username, 비번 일치)
    var login = authService.login(new LoginRequest(username, "Password123"));
    assertThat(login).isNotNull();
  }

  @Test
  void createMember_withoutEmail_succeeds() throws Exception {
    String adminAuth = tokenFor(seedUserWithRole("admin", "ADMIN"));
    String username = "noemail-" + UUID.randomUUID().toString().substring(0, 8);
    String json =
        objectMapper.writeValueAsString(
            new CreateMemberRequest(username, null, "이름만", "Password123", "USER"));

    mvc.perform(
            post("/api/v1/users")
                .header("Authorization", adminAuth)
                .contentType("application/json")
                .content(json))
        .andExpect(status().isCreated())
        // Jackson 기본 inclusion=ALWAYS → email 은 키가 있고 값이 null 로 직렬화된다(키 부재 아님).
        .andExpect(jsonPath("$.email").value(Matchers.nullValue()));
  }

  @Test
  void createMember_asAdminRole_assignsAdminRbacRole() throws Exception {
    String adminAuth = tokenFor(seedUserWithRole("admin", "ADMIN"));
    String username = "boss-" + UUID.randomUUID().toString().substring(0, 8);
    String json =
        objectMapper.writeValueAsString(
            new CreateMemberRequest(username, null, "관리자", "Password123", "ADMIN"));

    mvc.perform(
            post("/api/v1/users")
                .header("Authorization", adminAuth)
                .contentType("application/json")
                .content(json))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.role").value("ADMIN"));

    Long newId = dsl.select(USER.ID).from(USER).where(USER.USERNAME.eq(username)).fetchOne(USER.ID);
    Long assignedRole =
        dsl.select(USER_ROLE.ROLE_ID)
            .from(USER_ROLE)
            .where(USER_ROLE.USER_ID.eq(newId))
            .fetchOne(USER_ROLE.ROLE_ID);
    Long adminRoleId =
        dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    assertThat(assignedRole).isEqualTo(adminRoleId);
  }

  @Test
  void createMember_duplicateUsername_returns409() throws Exception {
    Long admin = seedUserWithRole("admin", "ADMIN");
    String dupUsername =
        dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(admin)).fetchOne(USER.USERNAME);
    String json =
        objectMapper.writeValueAsString(
            new CreateMemberRequest(dupUsername, null, "중복", "Password123", "USER"));

    mvc.perform(
            post("/api/v1/users")
                .header("Authorization", tokenFor(admin))
                .contentType("application/json")
                .content(json))
        .andExpect(status().isConflict());
  }

  @Test
  void createMember_usernameTooLong_returns400() throws Exception {
    String adminAuth = tokenFor(seedUserWithRole("admin", "ADMIN"));
    String tooLong = "a".repeat(51);
    String json =
        objectMapper.writeValueAsString(
            new CreateMemberRequest(tooLong, null, "긴아이디", "Password123", "USER"));

    mvc.perform(
            post("/api/v1/users")
                .header("Authorization", adminAuth)
                .contentType("application/json")
                .content(json))
        .andExpect(status().isBadRequest());
  }

  @Test
  void createMember_duplicateEmail_returns409() throws Exception {
    // 시드 사용자의 이메일을 그대로 재사용 → EmailAlreadyExistsException→409 매핑 검증.
    Long admin = seedUserWithRole("admin", "ADMIN");
    String dupEmail =
        dsl.select(USER.EMAIL).from(USER).where(USER.ID.eq(admin)).fetchOne(USER.EMAIL);
    String username = "dupmail-" + UUID.randomUUID().toString().substring(0, 8);
    String json =
        objectMapper.writeValueAsString(
            new CreateMemberRequest(username, dupEmail, "이메일중복", "Password123", "USER"));

    mvc.perform(
            post("/api/v1/users")
                .header("Authorization", tokenFor(admin))
                .contentType("application/json")
                .content(json))
        .andExpect(status().isConflict());
  }

  @Test
  void createMember_nameTooLong_returns400() throws Exception {
    String adminAuth = tokenFor(seedUserWithRole("admin", "ADMIN"));
    String username = "longname-" + UUID.randomUUID().toString().substring(0, 8);
    String json =
        objectMapper.writeValueAsString(
            new CreateMemberRequest(username, null, "가".repeat(51), "Password123", "USER"));

    mvc.perform(
            post("/api/v1/users")
                .header("Authorization", adminAuth)
                .contentType("application/json")
                .content(json))
        .andExpect(status().isBadRequest());
  }

  @Test
  void createMember_withoutPermission_returns403() throws Exception {
    // USER 역할만 — user:write/role:assign 없음 → 인터셉터가 차단.
    String weakAuth = tokenFor(seedUserWithRole("normal", "USER"));
    String json =
        objectMapper.writeValueAsString(
            new CreateMemberRequest(
                "x-" + UUID.randomUUID().toString().substring(0, 8),
                null,
                "거부",
                "Password123",
                "USER"));

    mvc.perform(
            post("/api/v1/users")
                .header("Authorization", weakAuth)
                .contentType("application/json")
                .content(json))
        .andExpect(status().isForbidden());
  }
}
