package com.workplace.user;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.role.service.RoleService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.UserService;
import java.util.Arrays;
import java.util.List;
import org.hamcrest.Matchers;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-728(결정 A) — 역할은 대상 종류(사람·AI)에 맞는 것만 새로 줄 수 있다.
 *
 * <ul>
 *   <li>AI 에게 ADMIN 이나 관리 권한이 든 역할을 주지 못한다. USER·AGENT·관리 권한 없는 역할은 준다.
 *   <li>사람에게 AGENT 시스템 역할을 주지 못한다.
 *   <li>이미 가진 역할은 그대로 둔다(다른 역할을 바꿀 때 막히지 않는다).
 *   <li>AI 가 가진 역할에 관리 권한을 더하지 못한다.
 *   <li>AI 가 자기 API 키를 발급·회수하지 못한다.
 * </ul>
 */
@Transactional
class RoleKindAssignmentTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired UserService userService;
  @Autowired RoleService roleService;

  private long admin;
  private long human;
  private long agent;
  private Long hrRole;
  private Long viewerRole;

  @BeforeEach
  void seed() {
    TenantContext.set(TENANT_ID);
    admin = member();
    grant(admin, roleId("ADMIN"));
    human = member();
    agent = TestFixtures.createAgentNoToken(dsl);
    TestFixtures.addMember(dsl, agent, TENANT_ID);
    grant(agent, roleId("AGENT"));
    hrRole = roleService.createRole("HR_728", null, admin).id();
    roleService.setRolePermissions(hrRole, permissionIds("user:read", "user:write"), admin);
    viewerRole = roleService.createRole("VIEWER_728", null, admin).id();
    roleService.setRolePermissions(viewerRole, permissionIds("project:read"), admin);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  void AI_에게_ADMIN_을_주지_못한다() throws Exception {
    setRoles(agent, roleId("AGENT"), roleId("ADMIN"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message", Matchers.containsString("AI 에이전트에게는 관리자 역할")));
    assertThat(roleNames(agent)).containsExactly("AGENT");
  }

  @Test
  void AI_에게_관리_권한이_든_역할을_주지_못한다() throws Exception {
    setRoles(agent, roleId("AGENT"), hrRole).andExpect(status().isBadRequest());
    assertThat(roleNames(agent)).containsExactly("AGENT");
  }

  @Test
  void AI_에게_USER_와_관리_권한_없는_역할은_준다() throws Exception {
    setRoles(agent, roleId("AGENT"), roleId("USER"), viewerRole).andExpect(status().isNoContent());
    assertThat(roleNames(agent)).containsExactlyInAnyOrder("AGENT", "USER", "VIEWER_728");
  }

  @Test
  void 사람에게_AGENT_역할을_주지_못한다() throws Exception {
    setRoles(human, roleId("AGENT"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("사람 구성원에게는 AGENT 역할을 줄 수 없습니다"));
  }

  @Test
  void 이미_가진_ADMIN_은_그대로_두고_다른_역할은_바꾼다() throws Exception {
    grant(agent, roleId("ADMIN")); // 정책 전에 받은 역할
    setRoles(agent, roleId("AGENT"), roleId("ADMIN"), viewerRole).andExpect(status().isNoContent());
    assertThat(roleNames(agent)).containsExactlyInAnyOrder("AGENT", "ADMIN", "VIEWER_728");
  }

  @Test
  void AI_확인카드_역할명_경로도_같은_기준으로_막는다() {
    // AGENT 역할을 가진 AI 는 이 경로가 원래 거절한다 — 역할 없는 AI 로 새 검사만 본다.
    long bare = TestFixtures.createAgentNoToken(dsl);
    TestFixtures.addMember(dsl, bare, TENANT_ID);
    assertThatThrownBy(() -> userService.validateSetRolesByNames(bare, List.of("ADMIN"), admin))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("AI 에이전트에게는");
  }

  /** WP-769: 외부 공유 정책(wiki_share:manage)만 든 역할도 관리 역할이다 — 받은 AI 가 정책을 끄면 모든 공개 링크가 풀린다. */
  @Test
  void AI_에게_외부_공유_정책_권한만_든_역할도_주지_못한다() throws Exception {
    Long shareRole = roleService.createRole("SHARE_769", null, admin).id();
    roleService.setRolePermissions(shareRole, permissionIds("wiki_share:manage"), admin);
    setRoles(agent, roleId("AGENT"), shareRole).andExpect(status().isBadRequest());
    assertThat(roleNames(agent)).containsExactly("AGENT");
  }

  /** WP-769: 공유 그룹 관리(user-group:manage)·플랫폼 권한만 든 역할도 AI 에게 주지 못하고, AI 가 가진 역할에 더하지도 못한다. */
  @Test
  void AI_에게_공유_그룹_관리나_플랫폼_권한이_든_역할도_주지_못한다() throws Exception {
    for (String code : List.of("user-group:manage", "platform:tenant:create")) {
      // 앞 회차의 MockMvc 요청이 끝나며 테넌트 컨텍스트를 지운다 — 서비스를 직접 부르기 전에 다시 세운다.
      TenantContext.set(TENANT_ID);
      Long role = roleService.createRole("R769_" + code.replace(':', '_'), null, admin).id();
      roleService.setRolePermissions(role, permissionIds(code), admin);
      setRoles(agent, roleId("AGENT"), role).andExpect(status().isBadRequest());
    }
    grant(agent, viewerRole);
    as(
            admin,
            put("/api/v1/roles/" + viewerRole + "/permissions")
                .content(perms("project:read", "wiki_share:manage")))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message", Matchers.containsString("wiki_share:manage")));
  }

  /**
   * WP-769: 관리 권한 목록은 「ADMIN 시스템 역할에만 있는 권한(일반 구성원 USER 에 없는 것) + 플랫폼 권한」과 같아야 한다. 마이그레이션으로 관리자 전용
   * 권한을 새로 더하고 목록을 빠뜨리면 여기서 걸린다(이번 빈틈이 그렇게 생겼다).
   */
  @Test
  void 관리_권한_목록은_ADMIN_에만_있는_권한과_플랫폼_권한이다() {
    java.util.Set<String> expected = new java.util.TreeSet<>(roleCodes("ADMIN"));
    expected.removeAll(roleCodes("USER"));
    expected.addAll(
        dsl.select(PERMISSION.CODE)
            .from(PERMISSION)
            .where(PERMISSION.CATEGORY.eq("platform"))
            .fetch(PERMISSION.CODE));
    assertThat(new java.util.TreeSet<>(com.workplace.role.dto.AdminPermissionCodes.CODES))
        .isEqualTo(expected);
  }

  @Test
  void AI_가_가진_역할에_관리_권한을_더하지_못한다() throws Exception {
    grant(agent, viewerRole);
    as(
            admin,
            put("/api/v1/roles/" + viewerRole + "/permissions")
                .content(perms("project:read", "role:assign")))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message", Matchers.containsString("role:assign")));
    // AI 가 갖지 않은 역할에는 그대로 더할 수 있다.
    as(
            admin,
            put("/api/v1/roles/" + hrRole + "/permissions")
                .content(perms("user:read", "user:write", "role:assign")))
        .andExpect(status().isNoContent());
  }

  @Test
  void AI_는_자기_API_키를_발급하지_못한다() throws Exception {
    grant(agent, roleId("ADMIN")); // 예전에 ADMIN 을 받은 AI 라도
    as(agent, post("/api/v1/admin/agents/" + agent + "/keys").content("{\"label\":\"self\"}"))
        .andExpect(status().isForbidden());
    assertThat(dsl.fetchCount(AGENT_API_KEY, AGENT_API_KEY.USER_ID.eq(agent))).isZero();
    // 사람 관리자는 발급한다.
    as(admin, post("/api/v1/admin/agents/" + agent + "/keys").content("{\"label\":\"admin\"}"))
        .andExpect(status().isOk());
  }

  @Test
  void 역할_목록은_관리_권한_역할을_표시한다() throws Exception {
    as(
            admin,
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                "/api/v1/roles"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.name=='ADMIN')].grantsAdmin").value(true))
        .andExpect(jsonPath("$[?(@.name=='USER')].grantsAdmin").value(false))
        .andExpect(jsonPath("$[?(@.name=='HR_728')].grantsAdmin").value(true))
        .andExpect(jsonPath("$[?(@.name=='VIEWER_728')].grantsAdmin").value(false));
  }

  private ResultActions setRoles(long target, Long... roleIds) throws Exception {
    return as(
        admin,
        put("/api/v1/users/" + target + "/roles")
            .content("{\"roleIds\":" + json(Arrays.asList(roleIds)) + "}"));
  }

  private String perms(String... codes) {
    return "{\"permissionIds\":" + json(permissionIds(codes)) + "}";
  }

  private static String json(List<Long> ids) {
    return ids.toString().replace(" ", "");
  }

  /** 인증 필터가 실어 주는 것처럼 호출자의 실제 권한을 authority 로 싣는다. */
  private ResultActions as(long caller, MockHttpServletRequestBuilder req) throws Exception {
    TenantContext.set(TENANT_ID);
    List<SimpleGrantedAuthority> authorities =
        dsl
            .selectDistinct(PERMISSION.CODE)
            .from(USER_ROLE)
            .join(com.workplace.jooq.Tables.ROLE_PERMISSION)
            .on(com.workplace.jooq.Tables.ROLE_PERMISSION.ROLE_ID.eq(USER_ROLE.ROLE_ID))
            .join(PERMISSION)
            .on(PERMISSION.ID.eq(com.workplace.jooq.Tables.ROLE_PERMISSION.PERMISSION_ID))
            .where(USER_ROLE.USER_ID.eq(caller))
            .fetch(PERMISSION.CODE)
            .stream()
            .map(SimpleGrantedAuthority::new)
            .toList();
    return mvc.perform(
        req.with(
                authentication(new UsernamePasswordAuthenticationToken(caller, "n/a", authorities)))
            .contentType(MediaType.APPLICATION_JSON));
  }

  private long member() {
    long id = TestFixtures.createHuman(dsl);
    TestFixtures.addMember(dsl, id, TENANT_ID);
    return id;
  }

  private void grant(long userId, Long roleId) {
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
  }

  private Long roleId(String name) {
    return dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(name)).fetchOne(ROLE.ID);
  }

  private List<String> roleNames(long userId) {
    return dsl.select(ROLE.NAME)
        .from(USER_ROLE)
        .join(ROLE)
        .on(ROLE.ID.eq(USER_ROLE.ROLE_ID))
        .where(USER_ROLE.USER_ID.eq(userId))
        .fetch(ROLE.NAME);
  }

  private List<String> roleCodes(String roleName) {
    return dsl.select(PERMISSION.CODE)
        .from(com.workplace.jooq.Tables.ROLE_PERMISSION)
        .join(PERMISSION)
        .on(PERMISSION.ID.eq(com.workplace.jooq.Tables.ROLE_PERMISSION.PERMISSION_ID))
        .join(ROLE)
        .on(ROLE.ID.eq(com.workplace.jooq.Tables.ROLE_PERMISSION.ROLE_ID))
        .where(ROLE.NAME.eq(roleName).and(ROLE.IS_SYSTEM.isTrue()))
        .fetch(PERMISSION.CODE);
  }

  private List<Long> permissionIds(String... codes) {
    return dsl.select(PERMISSION.ID)
        .from(PERMISSION)
        .where(PERMISSION.CODE.in(Arrays.asList(codes)))
        .fetch(PERMISSION.ID);
  }
}
