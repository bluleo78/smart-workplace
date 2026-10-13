package com.workplace.auth.controller;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.service.WorkspaceAssistantService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-371 — 에이전트 실행 방식(runtime) 관리 API 통합 테스트.
 *
 * <p>컬럼 기본값, PUT /runtime(204/409/404/403), 목록의 runtime·lastKeyUsedAt, 공통 비서 지정 가드를 검증한다.
 */
@Transactional
class AdminAgentRuntimeControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired WorkspaceAssistantService workspaceAssistantService;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private Authentication auth(Long userId, String... perms) {
    var authorities = java.util.Arrays.stream(perms).map(SimpleGrantedAuthority::new).toList();
    return new UsernamePasswordAuthenticationToken(userId, "n/a", authorities);
  }

  /** 테넌트#1 ACTIVE 멤버십을 가진 사용자(HUMAN/AGENT)를 만든다 — 목록 쿼리가 멤버십 join 이라 필요. */
  private Long createUser(String prefix, String kind) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .set(USER.KIND, kind)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    if ("HUMAN".equals(kind)) {
      dsl.update(USER).set(USER.PASSWORD, "pw").where(USER.ID.eq(id)).execute();
    }
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private String runtimeOf(Long userId) {
    return dsl.select(USER.AGENT_RUNTIME)
        .from(USER)
        .where(USER.ID.eq(userId))
        .fetchOne(USER.AGENT_RUNTIME);
  }

  private org.springframework.test.web.servlet.ResultActions putRuntime(
      Long admin, Long target, String body, String... perms) throws Exception {
    return mvc.perform(
        put("/api/v1/admin/agents/" + target + "/runtime")
            .with(authentication(auth(admin, perms)))
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
  }

  @Test
  void 새_AGENT_의_runtime_기본값은_INTERNAL() {
    Long agent = createUser("ai", "AGENT");
    assertThat(runtimeOf(agent)).isEqualTo("INTERNAL");
  }

  @Test
  void PUT_runtime_EXTERNAL_로_바꾸고_다시_INTERNAL_로_되돌린다_204() throws Exception {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");

    putRuntime(admin, agent, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isNoContent());
    assertThat(runtimeOf(agent)).isEqualTo("EXTERNAL");

    putRuntime(admin, agent, "{\"runtime\":\"INTERNAL\"}", "user:write")
        .andExpect(status().isNoContent());
    assertThat(runtimeOf(agent)).isEqualTo("INTERNAL");
  }

  @Test
  void PUT_runtime_변경은_감사_로그를_남긴다() throws Exception {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");

    putRuntime(admin, agent, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isNoContent());

    Integer cnt =
        dsl.fetchOne(
                "select count(*) from audit_log where action_type = 'AGENT_RUNTIME_CHANGED'"
                    + " and resource_id = ?",
                String.valueOf(agent))
            .get(0, Integer.class);
    assertThat(cnt).isEqualTo(1);
  }

  @Test
  void PUT_runtime_잘못된_값은_400() throws Exception {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    putRuntime(admin, agent, "{\"runtime\":\"CLOUD\"}", "user:write")
        .andExpect(status().isBadRequest());
    putRuntime(admin, agent, "{}", "user:write").andExpect(status().isBadRequest());
  }

  @Test
  void PUT_runtime_권한없으면_403() throws Exception {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    putRuntime(admin, agent, "{\"runtime\":\"EXTERNAL\"}", "other:perm")
        .andExpect(status().isForbidden());
  }

  @Test
  void PUT_runtime_사람_또는_없는_유저는_404() throws Exception {
    Long admin = createUser("admin", "HUMAN");
    Long human = createUser("bob", "HUMAN");
    putRuntime(admin, human, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isNotFound());
    putRuntime(admin, 99999999L, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isNotFound());
  }

  @Test
  void 공통_비서는_EXTERNAL_로_못_바꾼다_409() throws Exception {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    workspaceAssistantService.setAgent(admin, agent);

    putRuntime(admin, agent, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("공통 비서")));
    assertThat(runtimeOf(agent)).isEqualTo("INTERNAL");
    // INTERNAL 로의 변경(no-op 포함)은 막지 않는다.
    putRuntime(admin, agent, "{\"runtime\":\"INTERNAL\"}", "user:write")
        .andExpect(status().isNoContent());
  }

  @Test
  void 개인_비서는_EXTERNAL_로_못_바꾼다_409() throws Exception {
    Long admin = createUser("admin", "HUMAN");
    Long owner = createUser("owner", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    dsl.update(USER)
        .set(USER.PERSONAL_ASSISTANT_AGENT_ID, agent)
        .where(USER.ID.eq(owner))
        .execute();

    putRuntime(admin, agent, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("개인 비서")));
    assertThat(runtimeOf(agent)).isEqualTo("INTERNAL");
  }

  @Test
  void EXTERNAL_에이전트를_공통_비서로_지정하면_409() throws Exception {
    Long admin = createUser("admin", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    dsl.update(USER).set(USER.AGENT_RUNTIME, "EXTERNAL").where(USER.ID.eq(agent)).execute();

    mvc.perform(
            put("/api/v1/admin/workspace-assistant")
                .with(authentication(auth(admin, "user:write")))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"agentUserId\":" + agent + "}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("외부")));
  }

  @Test
  void 목록은_runtime_과_lastKeyUsedAt_을_준다_폐기_키는_제외() throws Exception {
    Long admin = createUser("admin", "HUMAN");
    Long used = createUser("used", "AGENT");
    Long unused = createUser("unused", "AGENT");
    dsl.update(USER).set(USER.AGENT_RUNTIME, "EXTERNAL").where(USER.ID.eq(used)).execute();
    OffsetDateTime older = OffsetDateTime.parse("2026-10-01T00:00:00Z");
    OffsetDateTime newer = OffsetDateTime.parse("2026-10-10T12:34:56Z");
    OffsetDateTime revokedLatest = OffsetDateTime.parse("2026-10-12T00:00:00Z");
    insertKey(used, admin, older, null);
    insertKey(used, admin, newer, null);
    insertKey(used, admin, revokedLatest, OffsetDateTime.parse("2026-10-12T01:00:00Z"));
    insertKey(unused, admin, null, null);

    var body =
        mvc.perform(get("/api/v1/admin/agents").with(authentication(auth(admin, "user:write"))))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    var root = new com.fasterxml.jackson.databind.ObjectMapper().readTree(body);
    boolean sawUsed = false;
    boolean sawUnused = false;
    for (var n : root) {
      if (n.get("id").asLong() == used) {
        sawUsed = true;
        assertThat(n.get("runtime").asText()).isEqualTo("EXTERNAL");
        assertThat(java.time.Instant.parse(n.get("lastKeyUsedAt").asText()))
            .isEqualTo(newer.toInstant());
      }
      if (n.get("id").asLong() == unused) {
        sawUnused = true;
        assertThat(n.get("runtime").asText()).isEqualTo("INTERNAL");
        assertThat(n.get("lastKeyUsedAt").isNull()).isTrue();
      }
    }
    assertThat(sawUsed && sawUnused).isTrue();
  }

  private void insertKey(
      Long agent, Long createdBy, OffsetDateTime lastUsed, OffsetDateTime revoked) {
    dsl.insertInto(AGENT_API_KEY)
        .set(AGENT_API_KEY.USER_ID, agent)
        .set(AGENT_API_KEY.KEY_PREFIX, "k")
        .set(AGENT_API_KEY.KEY_HASH, UUID.randomUUID().toString())
        .set(AGENT_API_KEY.CREATED_BY, createdBy)
        .set(AGENT_API_KEY.LAST_USED_AT, lastUsed)
        .set(AGENT_API_KEY.REVOKED_AT, revoked)
        .execute();
  }
}
