package com.workplace.auth.controller;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.service.WorkspaceAssistantService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.repository.UserRepository;
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
  // 락 호출 검증용 — 실제 동작은 그대로 두고 호출만 관찰한다.
  @Autowired UserRepository userRepository;

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

  /** AI 관리 API 를 부를 테넌트#1 관리자 — ADMIN 역할까지 준다(WP-729). */
  private Long createAdmin() {
    Long id = createUser("admin", "HUMAN");
    TestFixtures.grantRole(dsl, id, "ADMIN");
    return id;
  }

  /** 테넌트#1 ACTIVE 멤버십을 가진 사용자(HUMAN/AGENT)를 만든다 — 목록 쿼리가 멤버십 join 이라 필요. */
  private Long createUser(String prefix, String kind) {
    return createUser(prefix, kind, 1L);
  }

  private Long createUser(String prefix, String kind, long tenantId) {
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
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private org.springframework.test.web.servlet.ResultActions putRuntime(
      Long admin, Long target, String body, String... perms) throws Exception {
    // 요청 필터 체인이 끝나면 TenantContext 가 비워지므로, 한 테스트에서 여러 번 호출해도 tenant#1 로 다시 맞춘다.
    TenantContext.set(1L);
    return mvc.perform(
        put("/api/v1/admin/agents/" + target + "/runtime")
            .with(authentication(auth(admin, perms)))
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
  }

  /** 새 AGENT 의 runtime 기본값은 INTERNAL. */
  @Test
  void newAgent_defaultsToInternalRuntime() {
    Long agent = createUser("ai", "AGENT");
    assertThat(TestFixtures.runtimeOf(dsl, agent)).isEqualTo("INTERNAL");
  }

  /** PUT runtime — EXTERNAL 로 바꾸고 다시 INTERNAL 로 되돌린다(204). */
  @Test
  void putRuntime_externalThenInternal_returns204() throws Exception {
    Long admin = createAdmin();
    Long agent = createUser("ai", "AGENT");

    putRuntime(admin, agent, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isNoContent());
    assertThat(TestFixtures.runtimeOf(dsl, agent)).isEqualTo("EXTERNAL");

    putRuntime(admin, agent, "{\"runtime\":\"INTERNAL\"}", "user:write")
        .andExpect(status().isNoContent());
    assertThat(TestFixtures.runtimeOf(dsl, agent)).isEqualTo("INTERNAL");
  }

  /** PUT runtime 변경은 감사 로그를 남긴다. */
  @Test
  void putRuntime_whenChanged_writesAuditLog() throws Exception {
    Long admin = createAdmin();
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

  /** 같은 값으로 다시 PUT 하면 실행 방식이 바뀌지 않아 감사 로그를 또 남기지 않는다. */
  @Test
  void putRuntime_whenUnchanged_doesNotWriteAuditLogAgain() throws Exception {
    Long admin = createAdmin();
    Long agent = createUser("ai", "AGENT");

    putRuntime(admin, agent, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isNoContent());
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

  /** PUT runtime 잘못된 값은 400. */
  @Test
  void putRuntime_whenInvalidValue_returns400() throws Exception {
    Long admin = createAdmin();
    Long agent = createUser("ai", "AGENT");
    putRuntime(admin, agent, "{\"runtime\":\"CLOUD\"}", "user:write")
        .andExpect(status().isBadRequest());
    putRuntime(admin, agent, "{}", "user:write").andExpect(status().isBadRequest());
  }

  /** PUT runtime 권한 없으면 403. */
  @Test
  void putRuntime_withoutPermission_returns403() throws Exception {
    Long admin = createAdmin();
    Long agent = createUser("ai", "AGENT");
    putRuntime(admin, agent, "{\"runtime\":\"EXTERNAL\"}", "other:perm")
        .andExpect(status().isForbidden());
  }

  /** PUT runtime 대상이 사람이거나 없는 유저면 404. */
  @Test
  void putRuntime_whenHumanOrMissingUser_returns404() throws Exception {
    Long admin = createAdmin();
    Long human = createUser("bob", "HUMAN");
    putRuntime(admin, human, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isNotFound());
    putRuntime(admin, 99999999L, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isNotFound());
  }

  /** 공통 비서는 EXTERNAL 로 못 바꾼다(409). */
  @Test
  void putRuntime_whenWorkspaceAssistant_returns409() throws Exception {
    Long admin = createAdmin();
    Long agent = createUser("ai", "AGENT");
    workspaceAssistantService.setAgent(admin, agent);

    putRuntime(admin, agent, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("공통 비서")));
    assertThat(TestFixtures.runtimeOf(dsl, agent)).isEqualTo("INTERNAL");
    // INTERNAL 로의 변경(no-op 포함)은 막지 않는다.
    putRuntime(admin, agent, "{\"runtime\":\"INTERNAL\"}", "user:write")
        .andExpect(status().isNoContent());
  }

  /** 개인 비서는 EXTERNAL 로 못 바꾼다(409). */
  @Test
  void putRuntime_whenPersonalAssistant_returns409() throws Exception {
    Long admin = createAdmin();
    Long owner = createUser("owner", "HUMAN");
    Long agent = createUser("ai", "AGENT");
    dsl.update(USER)
        .set(USER.PERSONAL_ASSISTANT_AGENT_ID, agent)
        .where(USER.ID.eq(owner))
        .execute();

    putRuntime(admin, agent, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("개인 비서")));
    assertThat(TestFixtures.runtimeOf(dsl, agent)).isEqualTo("INTERNAL");
  }

  /**
   * 개인 비서를 해제하면 포인터(personal_assistant_agent_id)만 끊기고 행은 남는다. 재등록 시 같은 행이 username 으로 다시 연결되므로, 해제
   * 중에도 개인 비서 접두어 행은 EXTERNAL 로 못 바꾼다.
   */
  @Test
  void putRuntime_whenDisabledPersonalAssistant_returns409() throws Exception {
    Long admin = createAdmin();
    Long agent = createUser("ai", "AGENT");
    dsl.update(USER).set(USER.USERNAME, "__assistant_u" + agent).where(USER.ID.eq(agent)).execute();

    putRuntime(admin, agent, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("개인 비서")));
    assertThat(TestFixtures.runtimeOf(dsl, agent)).isEqualTo("INTERNAL");
  }

  /** EXTERNAL 에이전트를 공통 비서로 지정하면 409. */
  @Test
  void setWorkspaceAssistant_whenExternalAgent_returns409() throws Exception {
    Long admin = createAdmin();
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

  /** 목록은 runtime 과 lastKeyUsedAt 을 준다(폐기 키는 제외). */
  @Test
  void list_returnsRuntimeAndLastKeyUsedAt_excludingRevokedKeys() throws Exception {
    Long admin = createAdmin();
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

  /**
   * 만료된 키(Works 자동 발급 키의 수명이 다함)도 폐기 키처럼 lastKeyUsedAt 에서 뺀다(WP-1253) — 더는 인증되지 않는 키의 사용 시각으로 AI 가
   * 최근까지 쓰인 것처럼 보이지 않게.
   */
  @Test
  void list_lastKeyUsedAt_excludesExpiredKeys() throws Exception {
    Long admin = createAdmin();
    Long agent = createUser("expiring", "AGENT");
    OffsetDateTime active = OffsetDateTime.parse("2026-10-01T00:00:00Z");
    OffsetDateTime expiredLatest = OffsetDateTime.parse("2026-10-20T00:00:00Z");
    insertKey(agent, admin, active, null);
    Long expired = insertKey(agent, admin, expiredLatest, null);
    dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.EXPIRES_AT, OffsetDateTime.now().minusMinutes(1))
        .where(AGENT_API_KEY.ID.eq(expired))
        .execute();

    var body =
        mvc.perform(get("/api/v1/admin/agents").with(authentication(auth(admin, "user:write"))))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    var root = new com.fasterxml.jackson.databind.ObjectMapper().readTree(body);
    boolean saw = false;
    for (var n : root) {
      if (n.get("id").asLong() == agent) {
        saw = true;
        assertThat(java.time.Instant.parse(n.get("lastKeyUsedAt").asText()))
            .isEqualTo(active.toInstant());
      }
    }
    assertThat(saw).isTrue();
  }

  private Long insertKey(
      Long agent, Long createdBy, OffsetDateTime lastUsed, OffsetDateTime revoked) {
    return dsl.insertInto(AGENT_API_KEY)
        .set(AGENT_API_KEY.USER_ID, agent)
        .set(AGENT_API_KEY.KEY_PREFIX, "k")
        .set(AGENT_API_KEY.KEY_HASH, UUID.randomUUID().toString())
        .set(AGENT_API_KEY.CREATED_BY, createdBy)
        .set(AGENT_API_KEY.LAST_USED_AT, lastUsed)
        .set(AGENT_API_KEY.REVOKED_AT, revoked)
        .returning(AGENT_API_KEY.ID)
        .fetchOne()
        .getId();
  }

  /** 트랜잭션-로컬 RLS GUC 를 바꾼다 — 다른 테넌트 행을 시드할 때만 잠깐 쓰고 곧바로 1 로 되돌린다. */
  private void setGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  /** 다른 테넌트의 공통 비서인 에이전트도 EXTERNAL 로 못 바꾼다(409). */
  @Test
  void putRuntime_whenAssistantInOtherTenant_returns409() throws Exception {
    // 에이전트가 T1·T2 모두의 멤버이고, T2 의 공통 비서다. T1 관리자는 RLS 때문에 T2 의 workspace_assistant 행이 안 보인다.
    Long admin = createAdmin();
    Long agent = createUser("ai", "AGENT");
    long t2 = TestFixtures.createTenant(dsl, "ACTIVE");
    TestFixtures.addMember(dsl, agent, t2);
    setGuc(t2);
    dsl.execute(
        "INSERT INTO workspace_assistant (agent_user_id, updated_by) VALUES (?, ?)", agent, admin);
    setGuc(1L);

    putRuntime(admin, agent, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isConflict());
    assertThat(TestFixtures.runtimeOf(dsl, agent)).isEqualTo("INTERNAL");
  }

  /** 현재 테넌트(T1)의 멤버가 아닌 에이전트(다른 테넌트 소속)를 만든다. */
  private Long createForeignAgent() {
    long t2 = TestFixtures.createTenant(dsl, "ACTIVE");
    return createUser("foreign-ai", "AGENT", t2);
  }

  /** 다른 테넌트 에이전트의 runtime 변경은 404. */
  @Test
  void putRuntime_forOtherTenantAgent_returns404() throws Exception {
    Long admin = createAdmin();
    Long agent = createForeignAgent();
    putRuntime(admin, agent, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isNotFound());
    assertThat(TestFixtures.runtimeOf(dsl, agent)).isEqualTo("INTERNAL");
  }

  /** 다른 테넌트 에이전트의 이름 변경은 404. */
  @Test
  void rename_forOtherTenantAgent_returns404() throws Exception {
    Long admin = createAdmin();
    Long agent = createForeignAgent();
    TenantContext.set(1L);
    mvc.perform(
            put("/api/v1/admin/agents/" + agent)
                .with(authentication(auth(admin, "user:write")))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"hijack-bot\",\"name\":\"Hijack\"}"))
        .andExpect(status().isNotFound());
    assertThat(dsl.select(USER.NAME).from(USER).where(USER.ID.eq(agent)).fetchOne(USER.NAME))
        .isEqualTo("foreign-ai");
  }

  /** 다른 테넌트 에이전트의 삭제는 404. */
  @Test
  void delete_forOtherTenantAgent_returns404() throws Exception {
    Long admin = createAdmin();
    Long agent = createForeignAgent();
    TenantContext.set(1L);
    mvc.perform(
            delete("/api/v1/admin/agents/" + agent).with(authentication(auth(admin, "user:write"))))
        .andExpect(status().isNotFound());
    assertThat(dsl.fetchExists(dsl.selectOne().from(USER).where(USER.ID.eq(agent)))).isTrue();
  }

  /** 공통 비서 지정과 runtime 변경은 같은 user 행 락을 먼저 잡아 직렬화된다(동시 실행 시 검사-후-변경 경합 방지). */
  @Test
  void setAssistantAndPutRuntime_bothLockAgentRow() throws Exception {
    Long admin = createAdmin();
    Long agent = createUser("ai", "AGENT");

    workspaceAssistantService.setAgent(admin, agent);
    verify(userRepository, atLeastOnce()).lockForUpdate(eq(agent));

    Long agent2 = createUser("ai2", "AGENT");
    putRuntime(admin, agent2, "{\"runtime\":\"EXTERNAL\"}", "user:write")
        .andExpect(status().isNoContent());
    verify(userRepository, atLeastOnce()).lockForUpdate(eq(agent2));
  }
}
