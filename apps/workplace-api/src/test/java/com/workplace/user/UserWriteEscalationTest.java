package com.workplace.user;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.role.service.RoleService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.UserService;
import java.util.Arrays;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-729 — 「사용자 쓰기(user:write)」만 받은 구성원(예: 인사 담당 역할)이 관리자급 행동을 하던 길을 막는다.
 *
 * <ul>
 *   <li>정지·정지 해제는 역할 할당(WP-599)과 같은 기준 — ADMIN 이 아니면 자기 권한 안의 구성원만 바꿀 수 있다.
 *   <li>AI 관리(키 발급·회수, AI 연결, 실행 방식, 공용 비서)는 ADMIN 만 — 키 발급은 그 AI 의 멤버십 전체로 행동할 수 있게 하기 때문이다.
 * </ul>
 */
@Transactional
class UserWriteEscalationTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired UserService userService;
  @Autowired RoleService roleService;

  private long admin;
  private long admin2;
  private long hr;
  private long plain;
  private long agent;

  @BeforeEach
  void seed() {
    TenantContext.set(TENANT_ID);
    admin = member();
    grant(admin, roleId("ADMIN"));
    admin2 = member();
    grant(admin2, roleId("ADMIN"));
    hr = member();
    Long hrRole = roleService.createRole("HR-729", null, admin).id();
    roleService.setRolePermissions(hrRole, permissionIds("user:read", "user:write"), admin);
    grant(hr, hrRole);
    plain = member();
    agent = TestFixtures.createAgentNoToken(dsl);
    TestFixtures.addMember(dsl, agent, TENANT_ID);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  void user_write_만으로는_관리자를_정지하지_못한다() throws Exception {
    as(hr, put("/api/v1/users/" + admin2 + "/active").content("{\"active\":false}"))
        .andExpect(status().isForbidden());
    assertThat(statusOf(admin2)).isEqualTo("ACTIVE");
  }

  @Test
  void user_write_만으로는_정지된_관리자를_되살리지_못한다() throws Exception {
    as(admin, put("/api/v1/users/" + admin2 + "/active").content("{\"active\":false}"))
        .andExpect(status().isNoContent());
    as(hr, put("/api/v1/users/" + admin2 + "/active").content("{\"active\":true}"))
        .andExpect(status().isForbidden());
    assertThat(statusOf(admin2)).isEqualTo("SUSPENDED");
  }

  @Test
  void AI_확인카드_사전검증도_같은_기준으로_막는다() {
    assertThatThrownBy(() -> userService.validateSetActive(admin2, false, hr))
        .isInstanceOf(AccessDeniedException.class);
  }

  @Test
  void user_write_로_자기_권한_안의_구성원은_정지하고_되살린다() throws Exception {
    as(hr, put("/api/v1/users/" + plain + "/active").content("{\"active\":false}"))
        .andExpect(status().isNoContent());
    assertThat(statusOf(plain)).isEqualTo("SUSPENDED");
    as(hr, put("/api/v1/users/" + plain + "/active").content("{\"active\":true}"))
        .andExpect(status().isNoContent());
    assertThat(statusOf(plain)).isEqualTo("ACTIVE");
  }

  @Test
  void 관리자는_관리자도_정지한다() throws Exception {
    as(admin, put("/api/v1/users/" + admin2 + "/active").content("{\"active\":false}"))
        .andExpect(status().isNoContent());
    assertThat(statusOf(admin2)).isEqualTo("SUSPENDED");
  }

  @Test
  void user_write_만으로는_AI_를_관리하지_못한다() throws Exception {
    String base = "/api/v1/admin/agents/";
    as(hr, post(base + agent + "/keys").content("{\"label\":\"hr\"}"))
        .andExpect(status().isForbidden());
    as(hr, get(base + agent + "/keys")).andExpect(status().isForbidden());
    as(hr, get("/api/v1/admin/agents")).andExpect(status().isForbidden());
    as(hr, post("/api/v1/admin/agents").content("{\"username\":\"hrbot-729\",\"name\":\"hrbot\"}"))
        .andExpect(status().isForbidden());
    as(hr, put(base + agent + "/runtime").content("{\"runtime\":\"EXTERNAL\"}"))
        .andExpect(status().isForbidden());
    as(hr, get(base + agent + "/provider-credential")).andExpect(status().isForbidden());
    as(hr, get(base + agent + "/models")).andExpect(status().isForbidden());
    as(hr, get("/api/v1/admin/workspace-assistant")).andExpect(status().isForbidden());
    assertThat(dsl.fetchCount(AGENT_API_KEY, AGENT_API_KEY.USER_ID.eq(agent))).isZero();
  }

  @Test
  void 관리자는_AI_키를_발급한다() throws Exception {
    as(admin, post("/api/v1/admin/agents/" + agent + "/keys").content("{\"label\":\"admin\"}"))
        .andExpect(status().isOk());
    assertThat(dsl.fetchCount(AGENT_API_KEY, AGENT_API_KEY.USER_ID.eq(agent))).isEqualTo(1);
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

  private List<Long> permissionIds(String... codes) {
    return dsl.select(PERMISSION.ID)
        .from(PERMISSION)
        .where(PERMISSION.CODE.in(Arrays.asList(codes)))
        .fetch(PERMISSION.ID);
  }

  private String statusOf(long userId) {
    return dsl.select(MEMBERSHIP.STATUS)
        .from(MEMBERSHIP)
        .where(MEMBERSHIP.USER_ID.eq(userId).and(MEMBERSHIP.TENANT_ID.eq(TENANT_ID)))
        .fetchOne(MEMBERSHIP.STATUS);
  }
}
