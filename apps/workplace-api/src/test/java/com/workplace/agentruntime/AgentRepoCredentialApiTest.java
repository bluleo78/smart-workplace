package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_REPO_CREDENTIAL;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.exception.AgentRuntimeSettingConflictException;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1268 AI 별·호스트별 저장소 토큰 통합 테스트 — 관리자 API(등록·교체·폐기·목록·검증·감사·테넌트 격리), desired 의 repos 버전, runner
 * repos 비밀값 API, 켜기 전 저장소 토큰 확인.
 *
 * <p>위치 L1(기본)에 켜진 AI 둘(A1·A2)과 꺼진 AI 하나(A3). 토큰 원문은 테스트 상수로만 쓰고 단언은 응답·감사 행에 새지 않았는지 본다.
 */
@Transactional
@RecordApplicationEvents
class AgentRepoCredentialApiTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/agent-runtime/runner";
  private static final String TOKEN_A = "ghp_" + "A".repeat(36);
  private static final String TOKEN_B = "ghp_" + "B".repeat(36);
  private static final String TOKEN_C = "glpat-" + "C".repeat(30);

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired ApplicationEvents appEvents;

  private long admin;
  private AgentRuntimeTestFixtures fx;
  private long l1;
  private String t1;
  private long a1;
  private long a2;
  private long a3;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    fx = new AgentRuntimeTestFixtures(dsl, om, settingService, admin);
    var first = locationService.create(admin, new CreateAgentLocationRequest("L1", null, 5));
    l1 = first.location().id();
    t1 = first.plaintextToken();
    a1 = fx.runningAgent(null);
    a2 = fx.runningAgent(null);
    a3 = fx.newAgent(null);
  }

  /** 관리자 웹 세션으로 부른다 — 필터 체인이 끝나면 TenantContext 가 비워지므로 앞뒤로 맞춘다. */
  private ResultActions admin(MockHttpServletRequestBuilder b) throws Exception {
    TenantContext.set(1L);
    ResultActions r =
        mvc.perform(
            b.with(
                authentication(
                    WebSessionAuth.of(admin, List.of(new SimpleGrantedAuthority("user:write"))))));
    TenantContext.set(1L);
    return r;
  }

  /** runner 토큰으로 부른다. */
  private ResultActions runner(MockHttpServletRequestBuilder b) throws Exception {
    useTenant(1L);
    ResultActions r = mvc.perform(b.header("Authorization", "Bearer " + t1));
    useTenant(1L);
    return r;
  }

  private static String url(long agent) {
    return "/api/v1/admin/agents/" + agent + "/repo-credentials";
  }

  private static String body(String kind, String host, String token) {
    return "{\"kind\":\"" + kind + "\",\"host\":\"" + host + "\",\"token\":\"" + token + "\"}";
  }

  /** 등록(201) 응답 JSON. */
  private JsonNode register(long agent, String kind, String host, String token) throws Exception {
    return fx.json(
        admin(
                post(url(agent))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body(kind, host, token)))
            .andExpect(status().isCreated()));
  }

  private ResultActions registerRaw(long agent, String payload) throws Exception {
    return admin(post(url(agent)).contentType(MediaType.APPLICATION_JSON).content(payload));
  }

  /** desired 에서 AI 한 명의 repos 비밀값 참조. */
  private JsonNode reposRef(long agent) throws Exception {
    JsonNode desired = fx.json(runner(get(BASE + "/desired")).andExpect(status().isOk()));
    for (JsonNode a : desired.get("agents")) {
      if (a.get("agentUserId").asLong() != agent) continue;
      for (JsonNode s : a.get("secrets")) if ("repos".equals(s.get("name").asText())) return s;
    }
    throw new AssertionError("repos 참조 없음: " + agent);
  }

  private JsonNode reposSecret(long agent) throws Exception {
    return fx.json(
        runner(get(BASE + "/agents/" + agent + "/secrets/repos")).andExpect(status().isOk()));
  }

  /** 등록 응답은 메타만 싣고 토큰이 없다. 저장된 값은 암호문이다. */
  @Test
  void register_whenValid_returnsMetaWithoutTokenAndStoresCiphertext() throws Exception {
    JsonNode created = register(a1, "github", "GitHub.com", TOKEN_A);

    assertThat(created.get("kind").asText()).isEqualTo("GITHUB");
    assertThat(created.get("host").asText()).isEqualTo("github.com");
    assertThat(created.get("id").asLong()).isPositive();
    assertThat(created.get("createdAt").isNull()).isFalse();
    assertThat(created.get("lastUsedAt").isNull()).isTrue();
    assertThat(created.toString()).doesNotContain(TOKEN_A);

    String stored =
        dsl.select(AGENT_REPO_CREDENTIAL.ENCRYPTED_TOKEN)
            .from(AGENT_REPO_CREDENTIAL)
            .where(AGENT_REPO_CREDENTIAL.AGENT_USER_ID.eq(a1))
            .fetchOne(AGENT_REPO_CREDENTIAL.ENCRYPTED_TOKEN);
    assertThat(stored).isNotBlank().doesNotContain(TOKEN_A);
  }

  /** 목록은 활성만 host 오름차순이고 토큰 값이 어디에도 없다. */
  @Test
  void list_returnsActiveSortedByHostWithoutToken() throws Exception {
    register(a1, "GITLAB", "gitlab.iacloud.kr", TOKEN_C);
    register(a1, "GITHUB", "github.com", TOKEN_A);
    long gone = register(a1, "GITHUB", "ghe.example.com", TOKEN_B).get("id").asLong();
    admin(delete(url(a1) + "/" + gone)).andExpect(status().isNoContent());

    ResultActions r = admin(get(url(a1))).andExpect(status().isOk());
    JsonNode list = fx.json(r);
    assertThat(list).hasSize(2);
    assertThat(list.get(0).get("host").asText()).isEqualTo("github.com");
    assertThat(list.get(1).get("host").asText()).isEqualTo("gitlab.iacloud.kr");
    assertThat(list.get(1).get("kind").asText()).isEqualTo("GITLAB");
    assertThat(list.get(0).fieldNames())
        .toIterable()
        .containsExactlyInAnyOrder("id", "kind", "host", "createdAt", "lastUsedAt");
    assertThat(list.toString()).doesNotContain(TOKEN_A).doesNotContain(TOKEN_C);
  }

  /** 같은 host 를 두 번 등록하면 옛 행은 폐기되고 활성은 하나, 원문은 새 값이다. */
  @Test
  void register_whenSameHostTwice_keepsOneActiveAndReplacesToken() throws Exception {
    long first = register(a1, "GITHUB", "github.com", TOKEN_A).get("id").asLong();
    long second = register(a1, "GITHUB", "github.com", TOKEN_B).get("id").asLong();

    assertThat(second).isNotEqualTo(first);
    assertThat(
            dsl.fetchCount(
                AGENT_REPO_CREDENTIAL,
                AGENT_REPO_CREDENTIAL
                    .AGENT_USER_ID
                    .eq(a1)
                    .and(AGENT_REPO_CREDENTIAL.REVOKED_AT.isNull())))
        .isEqualTo(1);
    assertThat(dsl.fetchCount(AGENT_REPO_CREDENTIAL, AGENT_REPO_CREDENTIAL.AGENT_USER_ID.eq(a1)))
        .isEqualTo(2);
    JsonNode list = fx.json(admin(get(url(a1))));
    assertThat(list).hasSize(1);
    assertThat(list.get(0).get("id").asLong()).isEqualTo(second);
    assertThat(reposSecret(a1).at("/tokens/0/token").asText()).isEqualTo(TOKEN_B);
  }

  /** 폐기는 204, 목록에서 빠지고 같은 id 를 다시 폐기하면 404. */
  @Test
  void revoke_whenActive_returns204_thenAgain404() throws Exception {
    long id = register(a1, "GITHUB", "github.com", TOKEN_A).get("id").asLong();

    admin(delete(url(a1) + "/" + id)).andExpect(status().isNoContent());
    assertThat(fx.json(admin(get(url(a1))))).isEmpty();
    admin(delete(url(a1) + "/" + id)).andExpect(status().isNotFound());
  }

  /** 다른 AI 의 토큰 id 로는 폐기할 수 없다(404) — 남의 토큰은 건드리지 않는다. */
  @Test
  void revoke_whenCredentialBelongsToOtherAgent_returns404AndKeepsIt() throws Exception {
    long id = register(a1, "GITHUB", "github.com", TOKEN_A).get("id").asLong();

    admin(delete(url(a2) + "/" + id)).andExpect(status().isNotFound());

    assertThat(fx.json(admin(get(url(a1))))).hasSize(1);
  }

  /** 종류·호스트·토큰 형식이 틀리면 400 이고 아무것도 저장되지 않는다. 응답에 토큰 원문이 없다. */
  @Test
  void register_whenInvalid_returns400() throws Exception {
    registerRaw(a1, body("BITBUCKET", "github.com", TOKEN_A)).andExpect(status().isBadRequest());
    registerRaw(a1, body("GITHUB", "https://github.com", TOKEN_A))
        .andExpect(status().isBadRequest());
    registerRaw(a1, body("GITHUB", "github.com:443", TOKEN_A)).andExpect(status().isBadRequest());
    registerRaw(a1, body("GITHUB", "", TOKEN_A)).andExpect(status().isBadRequest());
    registerRaw(a1, body("GITHUB", "github.com", "short"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AGENT_REPO_CREDENTIAL_INVALID"));
    registerRaw(a1, body("GITHUB", "github.com", "x".repeat(2049)))
        .andExpect(status().isBadRequest());
    registerRaw(a1, "{}").andExpect(status().isBadRequest());

    assertThat(dsl.fetchCount(AGENT_REPO_CREDENTIAL)).isZero();
  }

  /** 앞뒤 공백이 있는 토큰은 다듬어 저장한다 — runner 가 받는 값에 공백이 없다. */
  @Test
  void register_whenTokenHasSurroundingWhitespace_storesTrimmed() throws Exception {
    register(a1, "GITHUB", "github.com", "  " + TOKEN_A + "\\n");

    assertThat(reposSecret(a1).at("/tokens/0/token").asText()).isEqualTo(TOKEN_A);
  }

  /** 사람(AI 아닌 구성원)에게는 등록할 수 없다(400) — AI 연결 등록과 같은 검사. */
  @Test
  void register_whenTargetIsNotAgent_returns400() throws Exception {
    registerRaw(admin, body("GITHUB", "github.com", TOKEN_A)).andExpect(status().isBadRequest());
  }

  /** 등록·폐기 감사 행에 대상 AI·kind·host 가 있고 토큰은 없다. */
  @Test
  void register_andRevoke_writeAuditRowsWithoutToken() throws Exception {
    long id = register(a1, "GITHUB", "github.com", TOKEN_A).get("id").asLong();
    admin(delete(url(a1) + "/" + id)).andExpect(status().isNoContent());

    var rows =
        dsl.select(AUDIT_LOG.ACTION_TYPE, AUDIT_LOG.DESCRIPTION, AUDIT_LOG.METADATA)
            .from(AUDIT_LOG)
            .where(
                AUDIT_LOG.ACTION_TYPE.in("AGENT_REPO_TOKEN_REGISTERED", "AGENT_REPO_TOKEN_REVOKED"))
            .fetch();
    assertThat(rows)
        .extracting(r -> r.value1())
        .containsExactlyInAnyOrder("AGENT_REPO_TOKEN_REGISTERED", "AGENT_REPO_TOKEN_REVOKED");
    for (var r : rows) {
      String meta = r.value3().data();
      assertThat(meta)
          .contains("github.com")
          .contains("GITHUB")
          .contains(String.valueOf(a1))
          .doesNotContain(TOKEN_A);
      assertThat(r.value2()).doesNotContain(TOKEN_A);
    }
  }

  /** 다른 워크스페이스의 AI 는 없는 것과 같고(404), 다른 테넌트에서는 행이 보이지 않는다. */
  @Test
  void repoCredentials_acrossTenants_areIsolated() throws Exception {
    register(a1, "GITHUB", "github.com", TOKEN_A);

    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    long foreign = TestFixtures.createAgentNoToken(dsl);
    TestFixtures.ensureActiveMember(dsl, foreign, tenant2);
    admin(get(url(foreign))).andExpect(status().isNotFound());
    registerRaw(foreign, body("GITHUB", "github.com", TOKEN_A)).andExpect(status().isNotFound());

    useTenant(tenant2);
    assertThat(dsl.fetchCount(AGENT_REPO_CREDENTIAL)).isZero();
    useTenant(1L);
    assertThat(dsl.fetchCount(AGENT_REPO_CREDENTIAL)).isEqualTo(1);
  }

  /** 웹 세션이 아니거나 권한이 없으면 쓸 수 없다. */
  @Test
  void register_withoutWebSessionOrPermission_returns403() throws Exception {
    TenantContext.set(1L);
    mvc.perform(
            post(url(a1))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("GITHUB", "github.com", TOKEN_A))
                .with(
                    authentication(
                        new org.springframework.security.authentication
                            .UsernamePasswordAuthenticationToken(
                            admin, "n/a", List.of(new SimpleGrantedAuthority("user:write"))))))
        .andExpect(status().isForbidden());
    TenantContext.set(1L);
    mvc.perform(get(url(a1)).with(authentication(WebSessionAuth.of(admin, List.of()))))
        .andExpect(status().isForbidden());
  }

  /** 행이 없으면 repos 버전은 null, 출처는 WORKS. 옛 github 참조는 더 이상 없다. */
  @Test
  void desired_whenNoCredentials_reposVersionNullFromWorks() throws Exception {
    JsonNode ref = reposRef(a1);

    assertThat(ref.get("source").asText()).isEqualTo("WORKS");
    assertThat(ref.get("version").isNull()).isTrue();
    JsonNode desired = fx.json(runner(get(BASE + "/desired")));
    for (JsonNode s : desired.at("/agents/0/secrets")) {
      assertThat(s.get("name").asText()).isNotEqualTo("github");
    }
  }

  /** 등록·교체·폐기마다 repos 버전이 바뀌고 다른 AI 의 버전은 그대로다. */
  @Test
  void desired_reposVersionChangesOnRegisterReplaceAndRevoke() throws Exception {
    long other = register(a2, "GITHUB", "github.com", TOKEN_B).get("id").asLong();
    long otherVersion = reposRef(a2).get("version").asLong();

    long id = register(a1, "GITHUB", "github.com", TOKEN_A).get("id").asLong();
    long v1 = reposRef(a1).get("version").asLong();
    long id2 = register(a1, "GITHUB", "github.com", TOKEN_C).get("id").asLong();
    long v2 = reposRef(a1).get("version").asLong();
    admin(delete(url(a1) + "/" + id2)).andExpect(status().isNoContent());
    long v3 = reposRef(a1).get("version").asLong();

    assertThat(id).isNotEqualTo(id2);
    assertThat(v2).isGreaterThan(v1);
    assertThat(v3).isGreaterThan(v2);
    assertThat(reposRef(a2).get("version").asLong()).isEqualTo(otherVersion);
    assertThat(other).isPositive();
  }

  /** 켜진 AI 의 토큰 등록·폐기는 그 위치의 runner 에게 desired 변경을 알린다. 꺼진 AI 는 알리지 않는다. */
  @Test
  void register_andRevoke_notifyRunnerLocationOnlyForRunningAgent() throws Exception {
    long before = appEvents.stream(AgentRuntimeDesiredChanged.class).count();

    long id = register(a1, "GITHUB", "github.com", TOKEN_A).get("id").asLong();
    long afterRegister = appEvents.stream(AgentRuntimeDesiredChanged.class).count();
    admin(delete(url(a1) + "/" + id)).andExpect(status().isNoContent());
    long afterRevoke = appEvents.stream(AgentRuntimeDesiredChanged.class).count();
    register(a3, "GITHUB", "github.com", TOKEN_A);
    long afterStopped = appEvents.stream(AgentRuntimeDesiredChanged.class).count();

    assertThat(afterRegister - before).isEqualTo(1);
    assertThat(afterRevoke - afterRegister).isEqualTo(1);
    assertThat(afterStopped).isEqualTo(afterRevoke);
    assertThat(
            appEvents.stream(AgentRuntimeDesiredChanged.class)
                .allMatch(e -> e.tenantId() == 1L && e.locationId() == l1))
        .isTrue();
  }

  /** runner 는 원문을 받고 no-store, 받아 간 시각이 last_used_at 에 남는다. 목록에는 여전히 토큰이 없다. */
  @Test
  void runnerRepos_returnsPlaintextSortedAndMarksLastUsed() throws Exception {
    register(a1, "GITLAB", "gitlab.iacloud.kr", TOKEN_C);
    register(a1, "GITHUB", "github.com", TOKEN_A);
    assertThat(fx.json(admin(get(url(a1)))).get(0).get("lastUsedAt").isNull()).isTrue();

    ResultActions r =
        runner(get(BASE + "/agents/" + a1 + "/secrets/repos"))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"));
    JsonNode secret = fx.json(r);

    assertThat(secret.get("version").asLong()).isEqualTo(reposRef(a1).get("version").asLong());
    assertThat(secret.get("tokens")).hasSize(2);
    assertThat(secret.at("/tokens/0/kind").asText()).isEqualTo("GITHUB");
    assertThat(secret.at("/tokens/0/host").asText()).isEqualTo("github.com");
    assertThat(secret.at("/tokens/0/token").asText()).isEqualTo(TOKEN_A);
    assertThat(secret.at("/tokens/1/host").asText()).isEqualTo("gitlab.iacloud.kr");
    assertThat(secret.at("/tokens/1/token").asText()).isEqualTo(TOKEN_C);
    JsonNode list = fx.json(admin(get(url(a1))));
    assertThat(list.get(0).get("lastUsedAt").isNull()).isFalse();
    assertThat(list.get(1).get("lastUsedAt").isNull()).isFalse();
    assertThat(list.toString()).doesNotContain(TOKEN_A);
  }

  /** 토큰이 없는 AI 는 빈 목록·version null(404 가 아니다) — runner 가 남은 키를 지운다. */
  @Test
  void runnerRepos_whenNoCredentials_returnsEmptyTokensAndNullVersion() throws Exception {
    JsonNode secret = reposSecret(a1);

    assertThat(secret.get("version").isNull()).isTrue();
    assertThat(secret.get("tokens")).isEmpty();
  }

  /** 켜져 있지 않은 AI·없는 AI 는 404(RUNNER_AGENT_NOT_FOUND). */
  @Test
  void runnerRepos_whenAgentNotRunning_returns404() throws Exception {
    register(a3, "GITHUB", "github.com", TOKEN_A);

    runner(get(BASE + "/agents/" + a3 + "/secrets/repos"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("RUNNER_AGENT_NOT_FOUND"));
    runner(get(BASE + "/agents/999999999/secrets/repos")).andExpect(status().isNotFound());
  }

  /** runner 토큰이 아니면 닿지 않는다. */
  @Test
  void runnerRepos_withoutRunnerToken_isRejected() throws Exception {
    TenantContext.set(1L);
    mvc.perform(get(BASE + "/agents/" + a1 + "/secrets/repos"))
        .andExpect(status().isUnauthorized());
  }

  /** 두 AI 가 서로 다른 GitHub 토큰을 각자 받는다 — 한 AI 의 토큰이 다른 AI 에게 가지 않는다. */
  @Test
  void runnerRepos_twoAgentsReceiveTheirOwnGithubTokens() throws Exception {
    register(a1, "GITHUB", "github.com", TOKEN_A);
    register(a2, "GITHUB", "github.com", TOKEN_B);

    JsonNode s1 = reposSecret(a1);
    JsonNode s2 = reposSecret(a2);

    assertThat(s1.at("/tokens/0/token").asText()).isEqualTo(TOKEN_A);
    assertThat(s2.at("/tokens/0/token").asText()).isEqualTo(TOKEN_B);
    assertThat(s1.get("tokens")).hasSize(1);
    assertThat(s2.get("tokens")).hasSize(1);
  }

  /** 응답 DTO 의 toString 은 토큰 원문을 싣지 않는다 — 로그에 새지 않게. */
  @Test
  void dtos_toStringHidesTokens() {
    var token =
        new com.workplace.agentruntime.dto.RunnerReposSecretResponse.Token(
            "GITHUB", "github.com", TOKEN_A);
    var res = new com.workplace.agentruntime.dto.RunnerReposSecretResponse(1L, List.of(token));
    var req =
        new com.workplace.agentruntime.dto.AgentRepoCredentialRequest(
            "GITHUB", "github.com", TOKEN_A);

    assertThat(token.toString()).doesNotContain(TOKEN_A);
    assertThat(res.toString()).doesNotContain(TOKEN_A);
    assertThat(req.toString()).doesNotContain(TOKEN_A);
  }

  /** 프로젝트를 만들고 AI 를 멤버로 둔다(저장소 URL 이 있는 프로젝트). */
  private void assignedProject(long agent, String url) {
    TenantContext.set(1L);
    long project =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "ZR" + (System.nanoTime() % 1_000_000))
            .set(PROJECT.NAME, "저장소 프로젝트")
            .set(PROJECT.OWNER_ID, admin)
            .set(PROJECT.TYPE, "TEAM")
            .set(PROJECT.REPOSITORY_URL, url)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.PROJECT_ID, project)
        .set(PROJECT_MEMBER.USER_ID, agent)
        .set(PROJECT_MEMBER.ROLE, "MEMBER")
        .execute();
  }

  /** 맡는 프로젝트 저장소 호스트에 토큰이 없으면 409 — 빠진 호스트만(정렬, 읽을 수 없는 URL 은 건너뜀), 토큰을 넣으면 통과. */
  @Test
  void start_whenRepoHostHasNoToken_returns409ThenPassesAfterRegister() throws Exception {
    assignedProject(a3, "https://gitlab.iacloud.kr/ttp/app.git");
    assignedProject(a3, "git@github.com:acme/repo.git");
    assignedProject(a3, "/local/path/not-a-url");

    assertThatThrownBy(() -> settingService.start(admin, a3))
        .isInstanceOf(AgentRuntimeSettingConflictException.class)
        .hasMessage("저장소 토큰이 연결되지 않아 실행할 수 없어요: github.com, gitlab.iacloud.kr");

    register(a3, "GITHUB", "github.com", TOKEN_A);
    TenantContext.set(1L);
    assertThatThrownBy(() -> settingService.start(admin, a3))
        .isInstanceOf(AgentRuntimeSettingConflictException.class)
        .hasMessage("저장소 토큰이 연결되지 않아 실행할 수 없어요: gitlab.iacloud.kr");

    register(a3, "GITLAB", "gitlab.iacloud.kr", TOKEN_C);
    TenantContext.set(1L);
    assertThat(settingService.start(admin, a3).desired().name()).isEqualTo("RUN");
  }

  /** 폐기한 토큰은 없는 것과 같다 — 다시 켜려면 막힌다. */
  @Test
  void start_whenTokenRevoked_returns409() throws Exception {
    assignedProject(a3, "https://github.com/acme/repo.git");
    long id = register(a3, "GITHUB", "github.com", TOKEN_A).get("id").asLong();
    admin(delete(url(a3) + "/" + id)).andExpect(status().isNoContent());
    TenantContext.set(1L);

    assertThatThrownBy(() -> settingService.start(admin, a3))
        .isInstanceOf(AgentRuntimeSettingConflictException.class)
        .hasMessageContaining("github.com");
  }

  /** 맡는 프로젝트가 없으면 토큰 없이도 켠다(막을 호스트가 없다). */
  @Test
  void start_whenNoAssignedRepositories_passesWithoutTokens() {
    TenantContext.set(1L);
    assertThat(settingService.start(admin, a3).desired().name()).isEqualTo("RUN");
  }
}
