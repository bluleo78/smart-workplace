package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.dto.AgentState;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.dto.RunnerObservedAgent;
import com.workplace.agentruntime.dto.RunnerObservedRequest;
import com.workplace.agentruntime.dto.RunnerPrincipal;
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository.Slot;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.agentruntime.service.RunnerDesiredStateService;
import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.dto.ManagedKeyChain;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.service.AgentApiKeyExpirySweeper;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.SqlStatementCounter;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.user.service.UserService;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
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
 * WP-1253 runner 비밀값 API 통합 테스트 — Works 가 띄운 AI 의 키 자동 발급·교체(generation 올림·옛 키 정리)·폐기(끄기·삭제·내부 전환),
 * 만료 키 인증 차단, desired 의 비밀값 버전, 모델 연결 원문 전달.
 *
 * <p>위치 2개(L1 기본·L2)와 AI 3명(A1 L1 켜짐, A2 L2 켜짐, A3 L1 꺼짐). runner 호출 전마다 GUC 를 토큰의 테넌트로
 * 맞춘다(RunnerApiTest 와 같은 이유).
 */
@Transactional
@RecordApplicationEvents
class RunnerSecretApiTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/agent-runtime/runner";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AgentApiKeyService keyService;
  @Autowired AgentApiKeyRepository keyRepo;
  @Autowired AiAgentCredentialService credentialService;
  @Autowired UserService userService;
  @Autowired ApplicationEvents appEvents;
  @Autowired RunnerDesiredStateService desiredService;
  @Autowired AgentApiKeyExpirySweeper sweeper;
  @Autowired AgentRuntimeSlotRepository slotRepo;

  private long admin;
  private AgentRuntimeTestFixtures fx;
  private long l1;
  private long l2;
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
    l2 =
        locationService
            .create(admin, new CreateAgentLocationRequest("L2", null, 5))
            .location()
            .id();
    a1 = fx.runningAgent(null);
    a2 = fx.runningAgent(l2);
    a3 = fx.newAgent(l1);
  }

  /** runner 토큰으로 부른다 — 호출 전에 GUC 를 테넌트 1 로 맞추고 호출 뒤에도 되돌린다. */
  private ResultActions runner(MockHttpServletRequestBuilder b) throws Exception {
    useTenant(1L);
    ResultActions r = mvc.perform(b.header("Authorization", "Bearer " + t1));
    useTenant(1L);
    return r;
  }

  /** A1 키 발급 응답(200). */
  private JsonNode issueKey(long agent) throws Exception {
    return fx.json(
        runner(post(BASE + "/agents/" + agent + "/agent-key")).andExpect(status().isOk()));
  }

  /** AI 키로 내 정보 조회. */
  private ResultActions me(String akKey) throws Exception {
    useTenant(1L);
    ResultActions r =
        mvc.perform(get("/api/v1/users/me").header("Authorization", "Bearer " + akKey));
    useTenant(1L);
    return r;
  }

  private OffsetDateTime expiresAtOf(long keyId) {
    return dsl.select(AGENT_API_KEY.EXPIRES_AT)
        .from(AGENT_API_KEY)
        .where(AGENT_API_KEY.ID.eq(keyId))
        .fetchOne(AGENT_API_KEY.EXPIRES_AT);
  }

  private long changedEvents() {
    return appEvents.stream(AgentRuntimeDesiredChanged.class).count();
  }

  /** 관리자 화면 실시간 알림(resource agent-runtime) 중 그 op 이고 그 AI 를 담은 것의 수(WP-1254). */
  private long runtimeEvents(String op, long agent) {
    return appEvents.stream(ResourceChangedEvent.class)
        .filter(e -> AgentRuntimeChangeNotifier.RESOURCE_AGENT_RUNTIME.equals(e.resource()))
        .filter(e -> op.equals(e.op()) && e.ids().contains(agent))
        .count();
  }

  private OffsetDateTime retiringAtOf(long keyId) {
    return dsl.select(AGENT_API_KEY.RETIRING_AT)
        .from(AGENT_API_KEY)
        .where(AGENT_API_KEY.ID.eq(keyId))
        .fetchOne(AGENT_API_KEY.RETIRING_AT);
  }

  /** 정리 유예에 들었는지 — 만료가 지금+5분 안으로 줄었고(조금의 실행 시간 여유를 둔다) 유예 표시(retiring_at, WP-1263)가 남았다. */
  private void assertRetiring(long keyId) {
    assertThat(expiresAtOf(keyId)).isBefore(OffsetDateTime.now().plusMinutes(5).plusSeconds(5));
    assertThat(retiringAtOf(keyId)).isNotNull();
  }

  /** 관리자 웹 세션 인증. */
  private MockHttpServletRequestBuilder asAdmin(MockHttpServletRequestBuilder b) {
    TenantContext.set(1L);
    return b.with(
        authentication(
            WebSessionAuth.of(admin, List.of(new SimpleGrantedAuthority("user:write")))));
  }

  /** 발급 응답의 평문은 바로 인증된다. 만료는 약 30일 뒤, rotateAfter 는 만료 7일 전이다. 캐시 금지. */
  @Test
  void issueAgentKey_returnsPlaintextOnceAndKeyAuthenticates() throws Exception {
    ResultActions r =
        runner(post(BASE + "/agents/" + a1 + "/agent-key"))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"));
    JsonNode body = fx.json(r);
    String plaintext = body.get("plaintext").asText();
    assertThat(plaintext).startsWith("ak_");
    OffsetDateTime expiresAt = OffsetDateTime.parse(body.get("expiresAt").asText());
    OffsetDateTime rotateAfter = OffsetDateTime.parse(body.get("rotateAfter").asText());
    assertThat(Duration.between(OffsetDateTime.now(), expiresAt))
        .isBetween(Duration.ofDays(30).minusMinutes(1), Duration.ofDays(30).plusMinutes(1));
    assertThat(Duration.between(rotateAfter, expiresAt)).isEqualTo(Duration.ofDays(7));

    me(plaintext).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(a1));
  }

  /**
   * 첫 발급은 generation 을 올리지 않는다. 지금 Pod 가 떠 있을 때(관찰 generation = generation) 두 번째(교체)는
   * generation+1·쉴 때 적용(IDLE)·변경 이벤트 1건, 새 키에 교체 generation 기록, 옛 키 만료는 그대로(지금 Pod 가 계속 쓴다).
   */
  @Test
  void issueAgentKey_again_bumpsGenerationIdleAndKeepsOldKey() throws Exception {
    long g0 = fx.generationOf(a1);
    long before = changedEvents();
    JsonNode first = issueKey(a1);
    assertThat(fx.generationOf(a1)).isEqualTo(g0);
    assertThat(changedEvents()).isEqualTo(before);
    long runtimeBefore = runtimeEvents("updated", a1);
    long oldId = first.get("keyId").asLong();
    OffsetDateTime oldExpires = expiresAtOf(oldId);
    setObservedGeneration(a1, g0);

    long newId = issueKey(a1).get("keyId").asLong();

    assertThat(fx.generationOf(a1)).isEqualTo(g0 + 1);
    assertThat(applyModeOf(a1)).isEqualTo("IDLE");
    assertThat(changedEvents()).isEqualTo(before + 1);
    // generation 이 올라 화면 상태가 「적용 대기」로 바뀌므로 관리자 화면에도 알린다(WP-1254).
    assertThat(runtimeEvents("updated", a1)).isEqualTo(runtimeBefore + 1);
    assertThat(expiresAtOf(oldId)).isEqualTo(oldExpires);
    assertThat(
            dsl.select(AGENT_API_KEY.ROTATION_GENERATION)
                .from(AGENT_API_KEY)
                .where(AGENT_API_KEY.ID.eq(newId))
                .fetchOne(AGENT_API_KEY.ROTATION_GENERATION))
        .isEqualTo(g0 + 1);
  }

  /**
   * 다시 시작이 건 바로 적용(NOW)이 아직 반영되지 않았으면 교체가 그것을 쉴 때 적용으로 늦추지 않는다. 지금 키는 앞 Pod 에 쓰였으므로 교체(generation
   * 올림)가 일어나는 경우다.
   */
  @Test
  void issueAgentKey_whilePendingApplyNow_keepsApplyModeNow() throws Exception {
    issueKey(a1);
    setObservedGeneration(a1, fx.generationOf(a1));
    TenantContext.set(1L);
    settingService.restart(admin, a1);
    long g = fx.generationOf(a1);

    issueKey(a1);

    assertThat(fx.generationOf(a1)).isEqualTo(g + 1);
    assertThat(applyModeOf(a1)).isEqualTo("NOW");
  }

  private void setObservedGeneration(long agent, long generation) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, generation)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  private String applyModeOf(long agent) {
    return dsl.select(AGENT_RUNTIME_SETTING.APPLY_MODE)
        .from(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .fetchOne(AGENT_RUNTIME_SETTING.APPLY_MODE);
  }

  /** 교체 generation 을 반영한 Pod 가 보고되면 옛 managed 키만 정리 유예로 줄인다. 그 전 generation 보고면 그대로. */
  @Test
  void observed_atRotationGeneration_shortensOldManagedKeys() throws Exception {
    long oldId = issueKey(a1).get("keyId").asLong();
    setObservedGeneration(a1, fx.generationOf(a1));
    JsonNode second = issueKey(a1);
    long newId = second.get("keyId").asLong();
    long rotationGen = fx.generationOf(a1);
    OffsetDateTime oldExpires = expiresAtOf(oldId);
    OffsetDateTime newExpires = expiresAtOf(newId);

    observed(a1, rotationGen - 1);
    assertThat(expiresAtOf(oldId)).isEqualTo(oldExpires);
    assertThat(retiringAtOf(oldId)).isNull();

    observed(a1, rotationGen);
    assertRetiring(oldId);
    assertThat(expiresAtOf(newId)).isEqualTo(newExpires);
    assertThat(retiringAtOf(newId)).isNull();

    // 같은 보고가 다시 와도 만료·유예 표시 시각이 늦춰지지 않는다.
    OffsetDateTime shortened = expiresAtOf(oldId);
    OffsetDateTime retiring = retiringAtOf(oldId);
    observed(a1, rotationGen);
    assertThat(expiresAtOf(oldId)).isEqualTo(shortened);
    assertThat(retiringAtOf(oldId)).isEqualTo(retiring);
  }

  private void observed(long agent, long generation) throws Exception {
    runner(
            post(BASE + "/observed")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"agents\":[{\"agentUserId\":"
                        + agent
                        + ",\"observedGeneration\":"
                        + generation
                        + ",\"phase\":\"RUNNING\"}]}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.updated").value(1));
  }

  /** 이 위치에서 켜져 있지 않은 AI(꺼진 AI·다른 위치 AI·없는 AI)는 404 — 키를 만들지 않는다. */
  @Test
  void issueAgentKey_forAgentNotRunningHere_returns404() throws Exception {
    runner(post(BASE + "/agents/" + a3 + "/agent-key"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("RUNNER_AGENT_NOT_FOUND"));
    runner(post(BASE + "/agents/" + a2 + "/agent-key")).andExpect(status().isNotFound());
    runner(post(BASE + "/agents/999999999/agent-key")).andExpect(status().isNotFound());
    assertThat(dsl.fetchCount(AGENT_API_KEY, AGENT_API_KEY.USER_ID.in(a2, a3))).isZero();
  }

  /** 만료된 managed 키로 일반 API 를 부르면 401. */
  @Test
  void apiCall_withExpiredManagedKey_returns401() throws Exception {
    JsonNode key = issueKey(a1);
    dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.EXPIRES_AT, OffsetDateTime.now().minusHours(1))
        .where(AGENT_API_KEY.ID.eq(key.get("keyId").asLong()))
        .execute();

    me(key.get("plaintext").asText()).andExpect(status().isUnauthorized());
  }

  /** 관리자가 발급한 키(만료 없음)는 자동 발급·교체·끄기와 상관없이 그대로 통한다. */
  @Test
  void apiCall_withAdminKey_stillWorks() throws Exception {
    TenantContext.set(1L);
    String adminKey = keyService.issue(admin, a1, new IssueAgentKeyRequest("수동")).plaintextKey();
    issueKey(a1);
    issueKey(a1);
    TenantContext.set(1L);
    settingService.stop(admin, a1);

    me(adminKey).andExpect(status().isOk());
  }

  /** desired 의 agent-key 버전은 발급 전 null, 발급 후 그 키 id. claude 버전은 연결 등록 뒤 그 연결 id. */
  @Test
  void desired_includesAgentKeyAndClaudeVersions() throws Exception {
    JsonNode before = fx.json(runner(get(BASE + "/desired")).andExpect(status().isOk()));
    JsonNode secrets = before.at("/agents/0/secrets");
    assertThat(secretNamed(secrets, "agent-key").get("source").asText()).isEqualTo("WORKS");
    assertThat(secretNamed(secrets, "agent-key").get("version").isNull()).isTrue();
    assertThat(secretNamed(secrets, "claude").get("version").isNull()).isTrue();
    assertThat(secretNamed(secrets, "repos").get("source").asText()).isEqualTo("WORKS");
    assertThat(secretNamed(secrets, "repos").get("version").isNull()).isTrue();

    JsonNode key = issueKey(a1);
    TenantContext.set(1L);
    long credId =
        credentialService.register(admin, a1, "anthropic", "X".repeat(64), "main", null).id();

    JsonNode after =
        fx.json(runner(get(BASE + "/desired")).andExpect(status().isOk())).at("/agents/0/secrets");
    assertThat(secretNamed(after, "agent-key").get("version").asLong())
        .isEqualTo(key.get("keyId").asLong());
    assertThat(secretNamed(after, "agent-key").get("rotateAfter").asText())
        .isNotBlank()
        .isNotEqualTo("null");
    assertThat(secretNamed(after, "claude").get("version").asLong()).isEqualTo(credId);
    assertThat(secretNamed(after, "claude").get("source").asText()).isEqualTo("WORKS");
  }

  private static JsonNode secretNamed(JsonNode secrets, String name) {
    for (JsonNode s : secrets) if (name.equals(s.get("name").asText())) return s;
    throw new AssertionError("비밀값 참조 없음: " + name);
  }

  /** 끄면 managed 키는 정리 유예로 줄고 관리자 키는 그대로다. */
  @Test
  void stop_shortensManagedKeysToGrace() throws Exception {
    long managedId = issueKey(a1).get("keyId").asLong();
    TenantContext.set(1L);
    long adminKeyId = keyService.issue(admin, a1, new IssueAgentKeyRequest("수동")).id();

    TenantContext.set(1L);
    settingService.stop(admin, a1);

    assertRetiring(managedId);
    assertThat(expiresAtOf(adminKeyId)).isNull();
  }

  /** AI 삭제·사용 중지 경로(stopForRemoval)도 managed 키를 정리 유예로 줄인다. */
  @Test
  void deleteAgent_shortensManagedKeys() throws Exception {
    long managedId = issueKey(a1).get("keyId").asLong();

    TenantContext.set(1L);
    settingService.stopForRemoval(a1, admin, true);
    // AI 삭제는 행이 곧 사라지므로 관리자 화면에 「지워짐」으로 알린다(WP-1254).
    assertThat(runtimeEvents("deleted", a1)).isEqualTo(1);

    assertRetiring(managedId);
  }

  /** 꺼진 AI 의 실행 설정 삭제와 「내부 · 기본」 전환도 남은 managed 키를 줄인다. */
  @Test
  void settingDeleteAndInternalSwitch_shortenManagedKeys() {
    OffsetDateTime far = OffsetDateTime.now().plusDays(30);
    long k3 = keyRepo.insertManaged(a3, 1L, "ak_test3", "hash-a3", "Works 자동 발급", far, null);
    TenantContext.set(1L);
    settingService.delete(admin, a3);
    assertRetiring(k3);

    TenantContext.set(1L);
    settingService.stop(admin, a2);
    long k2 = keyRepo.insertManaged(a2, 1L, "ak_test2", "hash-a2", "Works 자동 발급", far, null);
    TenantContext.set(1L);
    userService.setAgentRuntime(admin, a2, AgentRuntime.INTERNAL);
    assertRetiring(k2);
    // 「내부 · 기본」 전환으로 지운 설정도 관리자 화면에 「지워짐」으로 알린다(WP-1254).
    assertThat(runtimeEvents("deleted", a2)).isEqualTo(1);
  }

  /**
   * 관리자 키 상한(20)은 관리자 발급 키만 센다(WP-1253) — 자동 발급 키가 있어도 관리자 키 20개까지 발급되고, 21번째는 400 이다. 자동 발급 키는 회전
   * 주기가 묶는다.
   */
  @Test
  void adminIssue_limitCountsOnlyAdminKeys() throws Exception {
    issueKey(a1);
    issueKey(a1);
    TenantContext.set(1L);
    for (int i = 0; i < 20; i++) keyService.issue(admin, a1, new IssueAgentKeyRequest("k" + i));

    TenantContext.set(1L);
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> keyService.issue(admin, a1, new IssueAgentKeyRequest("over")))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(keyRepo.countActiveAdmin(a1)).isEqualTo(20);
  }

  /** 관리자 키가 상한(20)까지 차 있어도 자동 발급은 막히지 않고, 관리자 키를 건드리지 않는다(WP-1253). */
  @Test
  void issueAgentKey_withAdminKeysAtLimit_stillIssuesAndKeepsAdminKeys() throws Exception {
    TenantContext.set(1L);
    for (int i = 0; i < 20; i++) keyService.issue(admin, a1, new IssueAgentKeyRequest("k" + i));

    long issued = issueKey(a1).get("keyId").asLong();

    assertThat(expiresAtOf(issued)).isAfter(OffsetDateTime.now());
    assertThat(keyRepo.countActiveAdmin(a1)).isEqualTo(20);
  }

  /** 전달되지 않은 재발급 전 키는 만료와 함께 회수 시각도 남는다(WP-1253) — 활성 키 인덱스에서 빠지게. */
  @Test
  void issueAgentKey_retry_revokesUndeliveredKey() throws Exception {
    long first = issueKey(a1).get("keyId").asLong();

    issueKey(a1);

    assertThat(revokedAtOf(first)).isNotNull();
  }

  /** 정기 정리는 만료 뒤 하루가 지난 자동 발급 키에만 회수 시각을 남긴다 — 막 만료된 키·관리자 키는 그대로다(WP-1253). */
  @Test
  void expirySweep_revokesOnlyKeysExpiredOverADayAgo() throws Exception {
    long old =
        keyRepo.insertManaged(
            a1, 1L, "ak_old", "hash-old", "Works 자동 발급", OffsetDateTime.now().minusDays(2), 1L);
    long recent =
        keyRepo.insertManaged(
            a1,
            1L,
            "ak_recent",
            "hash-recent",
            "Works 자동 발급",
            OffsetDateTime.now().minusHours(1),
            1L);
    TenantContext.set(1L);
    long adminKeyId = keyService.issue(admin, a1, new IssueAgentKeyRequest("수동")).id();

    sweeper.sweep();

    assertThat(revokedAtOf(old)).isNotNull();
    assertThat(revokedAtOf(recent)).isNull();
    assertThat(revokedAtOf(adminKeyId)).isNull();
  }

  private OffsetDateTime revokedAtOf(long keyId) {
    return dsl.select(AGENT_API_KEY.REVOKED_AT)
        .from(AGENT_API_KEY)
        .where(AGENT_API_KEY.ID.eq(keyId))
        .fetchOne(AGENT_API_KEY.REVOKED_AT);
  }

  /** 모델 연결 원문을 캐시 금지로 넘긴다. version 은 연결 id. */
  @Test
  void claudeSecret_returnsDecryptedPayloadWithNoStore() throws Exception {
    TenantContext.set(1L);
    long credId =
        credentialService.register(admin, a1, "anthropic", "T".repeat(64), "main", null).id();

    runner(get(BASE + "/agents/" + a1 + "/secrets/claude"))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.version").value(credId))
        .andExpect(jsonPath("$.provider").value("anthropic"))
        .andExpect(jsonPath("$.payload").value("T".repeat(64)));
  }

  /** 연결이 없으면 404, 이 위치에서 켜져 있지 않은 AI 도 404. */
  @Test
  void claudeSecret_withoutCredential_returns404() throws Exception {
    runner(get(BASE + "/agents/" + a1 + "/secrets/claude"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("RUNNER_SECRET_NOT_FOUND"));

    TenantContext.set(1L);
    credentialService.register(admin, a2, "anthropic", "T".repeat(64), "main", null);
    runner(get(BASE + "/agents/" + a2 + "/secrets/claude"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("RUNNER_AGENT_NOT_FOUND"));
  }

  /** 관리자 키 목록에 자동 발급 여부와 만료가 보인다. */
  @Test
  void adminKeyList_showsManagedAndExpiresAt() throws Exception {
    long managedId = issueKey(a1).get("keyId").asLong();
    TenantContext.set(1L);
    long adminKeyId = keyService.issue(admin, a1, new IssueAgentKeyRequest("수동")).id();

    JsonNode list =
        fx.json(
            mvc.perform(asAdmin(get("/api/v1/admin/agents/" + a1 + "/keys")))
                .andExpect(status().isOk()));

    for (JsonNode k : list) {
      if (k.get("id").asLong() == managedId) {
        assertThat(k.get("managed").asBoolean()).isTrue();
        assertThat(k.get("expiresAt").isNull()).isFalse();
        assertThat(k.get("label").asText()).isEqualTo("Works 자동 발급");
      } else if (k.get("id").asLong() == adminKeyId) {
        assertThat(k.get("managed").asBoolean()).isFalse();
        assertThat(k.get("expiresAt").isNull()).isTrue();
      }
    }
    assertThat(list).hasSize(2);
  }

  /**
   * 다른 워크스페이스가 같은 AI 에 자동 발급한 키는 이 워크스페이스 관리자 목록에 보이지 않는다(WP-1253) — 그쪽 Pod 의 키다. 관리자 발급 키와 이
   * 워크스페이스의 자동 발급 키는 보인다.
   */
  @Test
  void adminKeyList_hidesManagedKeysOfOtherWorkspace() throws Exception {
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    long foreign =
        keyRepo.insertManaged(
            a1,
            tenant2,
            "ak_foreign",
            "hash-foreign",
            "Works 자동 발급",
            OffsetDateTime.now().plusDays(20),
            null);
    long own = issueKey(a1).get("keyId").asLong();
    TenantContext.set(1L);
    long adminKeyId = keyService.issue(admin, a1, new IssueAgentKeyRequest("수동")).id();

    JsonNode list =
        fx.json(
            mvc.perform(asAdmin(get("/api/v1/admin/agents/" + a1 + "/keys")))
                .andExpect(status().isOk()));

    assertThat(list.findValuesAsText("id"))
        .containsExactlyInAnyOrder(String.valueOf(own), String.valueOf(adminKeyId))
        .doesNotContain(String.valueOf(foreign));
  }

  /** 다른 워크스페이스가 자동 발급한 키는 회수할 수 없다 — 없는 키처럼 404 이고 키는 그대로다(WP-1253). */
  @Test
  void adminRevoke_managedKeyOfOtherWorkspace_returns404() throws Exception {
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    long foreign =
        keyRepo.insertManaged(
            a1,
            tenant2,
            "ak_foreign",
            "hash-foreign",
            "Works 자동 발급",
            OffsetDateTime.now().plusDays(20),
            null);

    mvc.perform(asAdmin(delete("/api/v1/admin/agents/" + a1 + "/keys/" + foreign)))
        .andExpect(status().isNotFound());

    assertThat(revokedAtOf(foreign)).isNull();
  }

  /** 자동 발급 감사 기록은 남되 평문(접두사 포함)은 없다. */
  @Test
  void auditLogs_doNotContainPlaintext() throws Exception {
    String plaintext = issueKey(a1).get("plaintext").asText();
    issueKey(a1);

    var rows =
        dsl.select(AUDIT_LOG.DESCRIPTION, AUDIT_LOG.METADATA, AUDIT_LOG.USER_ID)
            .from(AUDIT_LOG)
            .where(AUDIT_LOG.ACTION_TYPE.eq("AGENT_KEY_ISSUED"))
            .and(AUDIT_LOG.RESOURCE.eq("agent_api_key"))
            .fetch();
    assertThat(rows).hasSize(2);
    for (var r : rows) {
      String text = r.value1() + " " + (r.value2() == null ? "" : r.value2().data());
      assertThat(text).doesNotContain(plaintext).doesNotContain(plaintext.substring(0, 12));
      assertThat(r.value1()).contains("Works 자동 발급").contains("L1");
      assertThat(r.value3()).isNull();
    }
  }

  // ── WP-1253 리뷰 보강 ─────────────────────────────────────────────────────────────

  /** 다른 토큰·테넌트로 runner 를 부른다 — 호출 전후로 GUC 를 그 테넌트로 맞춘다. */
  private ResultActions runnerAs(MockHttpServletRequestBuilder b, String token, long tenant)
      throws Exception {
    useTenant(tenant);
    ResultActions r = mvc.perform(b.header("Authorization", "Bearer " + token));
    useTenant(tenant);
    return r;
  }

  private void observedAs(String token, long tenant, long agent, long generation) throws Exception {
    runnerAs(
            post(BASE + "/observed")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"agents\":[{\"agentUserId\":"
                        + agent
                        + ",\"observedGeneration\":"
                        + generation
                        + ",\"phase\":\"RUNNING\"}]}"),
            token,
            tenant)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.updated").value(1));
  }

  private long agentKeyVersion(JsonNode desired, long agent) {
    for (JsonNode a : desired.get("agents")) {
      if (a.get("agentUserId").asLong() == agent) {
        return secretNamed(a.get("secrets"), "agent-key").get("version").asLong();
      }
    }
    throw new AssertionError("desired 에 AI 없음: " + agent);
  }

  /**
   * 두 워크스페이스에서 Works 가 띄운 같은 AI — managed 키 사슬이 워크스페이스마다 따로다(WP-1253). 테넌트 1 의 교체·관찰 정리·끄기가 테넌트 2 의
   * 키를 건드리지 않고, 각 desired 는 자기 워크스페이스 키 버전을 싣는다.
   */
  @Test
  void managedKeys_ofAgentInTwoTenants_areIndependentPerTenant() throws Exception {
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    useTenant(tenant2);
    long admin2 = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    var loc2 = locationService.create(admin2, new CreateAgentLocationRequest("남의 위치", null, 3));
    String t2 = loc2.plaintextToken();
    TestFixtures.ensureActiveMember(dsl, a1, tenant2);
    settingService.put(
        admin2, a1, new PutAgentRuntimeSettingRequest("claude-code", null, Map.of(), null));
    settingService.start(admin2, a1);

    long k1 = issueKey(a1).get("keyId").asLong();
    long k2 =
        fx.json(
                runnerAs(post(BASE + "/agents/" + a1 + "/agent-key"), t2, tenant2)
                    .andExpect(status().isOk()))
            .get("keyId")
            .asLong();
    OffsetDateTime k2Expires = expiresAtOf(k2);

    // 테넌트 2 의 desired 는 테넌트 2 키를, 테넌트 1 의 desired 는 테넌트 1 키를 싣는다.
    assertThat(agentKeyVersion(fx.json(runner(get(BASE + "/desired"))), a1)).isEqualTo(k1);
    assertThat(agentKeyVersion(fx.json(runnerAs(get(BASE + "/desired"), t2, tenant2)), a1))
        .isEqualTo(k2);

    // 테넌트 2 의 Pod 가 떠 있어도 테넌트 1 의 첫 키 재발급은 테넌트 1 만 본다 — 테넌트 1 에서 교체 → 관찰 → 끄기.
    useTenant(1L);
    setObservedGeneration(a1, fx.generationOf(a1));
    long k1b = issueKey(a1).get("keyId").asLong();
    useTenant(1L);
    observedAs(t1, 1L, a1, fx.generationOf(a1));
    assertRetiring(k1);
    TenantContext.set(1L);
    settingService.stop(admin, a1);
    assertRetiring(k1b);

    assertThat(expiresAtOf(k2)).isEqualTo(k2Expires);
    assertThat(agentKeyVersion(fx.json(runnerAs(get(BASE + "/desired"), t2, tenant2)), a1))
        .isEqualTo(k2);
    useTenant(1L);
  }

  /**
   * 떠 있는 Pod 의 키가 이미 죽었으면(활성 managed 키 없음 · 전에 있었음 · Pod 관찰됨) 새 키 발급이 generation 을 올리고 바로 적용(NOW)한다
   * — 죽은 키로는 쉬는 중을 보고할 수 없다(WP-1253).
   */
  @Test
  void issueAgentKey_whenRunningPodKeyIsDead_bumpsGenerationWithApplyNow() throws Exception {
    long dead = issueKey(a1).get("keyId").asLong();
    long g = fx.generationOf(a1);
    setObservedGeneration(a1, g);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, "IDLE")
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(a1))
        .execute();
    dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.REVOKED_AT, OffsetDateTime.now())
        .where(AGENT_API_KEY.ID.eq(dead))
        .execute();
    long before = changedEvents();

    long newId = issueKey(a1).get("keyId").asLong();

    assertThat(fx.generationOf(a1)).isEqualTo(g + 1);
    assertThat(applyModeOf(a1)).isEqualTo("NOW");
    assertThat(changedEvents()).isEqualTo(before + 1);
    assertThat(rotationGenerationOf(newId)).isEqualTo(g + 1);
  }

  private Long rotationGenerationOf(long keyId) {
    return dsl.select(AGENT_API_KEY.ROTATION_GENERATION)
        .from(AGENT_API_KEY)
        .where(AGENT_API_KEY.ID.eq(keyId))
        .fetchOne(AGENT_API_KEY.ROTATION_GENERATION);
  }

  private boolean applyNowOf(long agent) throws Exception {
    for (JsonNode a : fx.json(runner(get(BASE + "/desired"))).get("agents")) {
      if (a.get("agentUserId").asLong() == agent) return a.get("applyNow").asBoolean();
    }
    throw new AssertionError("desired 에 AI 없음: " + agent);
  }

  /**
   * 쉴 때 적용으로 미룬 키 교체 중 AI 가 계속 일하고 있어도, 지금 Pod 가 쓰는 옛 키가 24시간 안에 만료되면 applyNow 가 참이 된다(WP-1253) —
   * 죽을 키로 계속 돌지 않게.
   */
  @Test
  void desired_whenPodKeyExpiresWithin24h_appliesNowEvenWhileWorking() throws Exception {
    long podKey = issueKey(a1).get("keyId").asLong();
    setObservedGeneration(a1, fx.generationOf(a1));
    issueKey(a1);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.AGENT_STATE, "WORKING")
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(a1))
        .execute();
    assertThat(applyNowOf(a1)).isFalse();

    dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.EXPIRES_AT, OffsetDateTime.now().plusHours(2))
        .where(AGENT_API_KEY.ID.eq(podKey))
        .execute();

    assertThat(applyNowOf(a1)).isTrue();
  }

  /**
   * 교체 키를 받은 뒤 새 Pod 가 관찰되기 전에 runner 가 다시 요청하면(응답을 놓친 재시도) generation 을 또 올리지 않는다 — 같은 교체
   * generation 으로 새 키를 주고 전달되지 않은 앞 키는 바로 만료시킨다. 지금 Pod 의 옛 키는 그대로다(WP-1253).
   */
  @Test
  void issueAgentKey_retryWhileRotationPending_doesNotBumpAgain() throws Exception {
    long podKey = issueKey(a1).get("keyId").asLong();
    long g = fx.generationOf(a1);
    setObservedGeneration(a1, g);
    long before = changedEvents();
    long pending = issueKey(a1).get("keyId").asLong();

    long retried = issueKey(a1).get("keyId").asLong();

    assertThat(fx.generationOf(a1)).isEqualTo(g + 1);
    assertThat(changedEvents()).isEqualTo(before + 1);
    assertThat(expiresAtOf(pending)).isBeforeOrEqualTo(OffsetDateTime.now());
    assertThat(rotationGenerationOf(retried)).isEqualTo(g + 1);
    assertThat(keyService.managedChain(a1, 1L).keys())
        .extracting(ManagedKeyChain.Key::id)
        .containsExactly(podKey, retried);
  }

  /** 첫 키를 쓴 Pod 가 아직 관찰되지 않았을 때의 재요청도 generation 을 올리지 않고 앞 키를 바꿔 준다(WP-1253). */
  @Test
  void issueAgentKey_retryBeforeFirstPodObserved_replacesWithoutBump() throws Exception {
    long g = fx.generationOf(a1);
    long before = changedEvents();
    long first = issueKey(a1).get("keyId").asLong();

    long second = issueKey(a1).get("keyId").asLong();

    assertThat(fx.generationOf(a1)).isEqualTo(g);
    assertThat(changedEvents()).isEqualTo(before);
    assertThat(expiresAtOf(first)).isBeforeOrEqualTo(OffsetDateTime.now());
    assertThat(rotationGenerationOf(second)).isEqualTo(g);
    assertThat(keyService.managedChain(a1, 1L).keys())
        .extracting(ManagedKeyChain.Key::id)
        .containsExactly(second);
  }

  /** 키 교체가 generation 을 올려도 관리자가 남긴 updated_by·설정은 그대로다(WP-1253). */
  @Test
  void issueAgentKey_rotation_keepsUpdatedByAndConfig() throws Exception {
    issueKey(a1);
    setObservedGeneration(a1, fx.generationOf(a1));
    var before =
        dsl.select(AGENT_RUNTIME_SETTING.UPDATED_BY, AGENT_RUNTIME_SETTING.CONFIG)
            .from(AGENT_RUNTIME_SETTING)
            .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(a1))
            .fetchOne();

    issueKey(a1);

    var after =
        dsl.select(AGENT_RUNTIME_SETTING.UPDATED_BY, AGENT_RUNTIME_SETTING.CONFIG)
            .from(AGENT_RUNTIME_SETTING)
            .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(a1))
            .fetchOne();
    assertThat(after.value1()).isEqualTo(admin);
    assertThat(after.value2()).isEqualTo(before.value2());
  }

  private void setAgentState(long agent, String state, OffsetDateTime reportedAt) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.AGENT_STATE, state)
        .set(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY, state == null ? null : "WP-1")
        .set(AGENT_RUNTIME_SETTING.AGENT_REPORTED_AT, reportedAt)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  private org.jooq.Record settingRow(long agent) {
    return dsl.selectFrom(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .fetchOne();
  }

  private void observedRaw(String agentJson) throws Exception {
    runner(
            post(BASE + "/observed")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"agents\":[" + agentJson + "]}"))
        .andExpect(status().isOk());
  }

  /** 새 Pod 가 뜨면(STARTING) 옛 Pod 가 보고한 AI 상태를 지운다 — 옛 「쉬는 중」으로 새 Pod 를 바로 갈아치우지 않게(WP-1253). */
  @Test
  void observed_newPodStarting_clearsStaleAgentState() throws Exception {
    long g = fx.generationOf(a1);
    setAgentState(a1, "IDLE", OffsetDateTime.now().minusMinutes(10));

    observedRaw(
        "{\"agentUserId\":"
            + a1
            + ",\"observedGeneration\":"
            + g
            + ",\"phase\":\"STARTING\",\"startedAt\":\""
            + OffsetDateTime.now()
            + "\"}");

    var row = settingRow(a1);
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_REPORTED_AT)).isNull();
  }

  /** 같은 Pod 의 되풀이 보고(같은 시작 시각·같은 generation)는 AI 상태를 그대로 둔다(WP-1253). */
  @Test
  void observed_samePodReport_keepsAgentState() throws Exception {
    long g = fx.generationOf(a1);
    OffsetDateTime started = OffsetDateTime.parse("2026-11-01T00:00:00Z");
    String report =
        "{\"agentUserId\":"
            + a1
            + ",\"observedGeneration\":"
            + g
            + ",\"phase\":\"RUNNING\",\"startedAt\":\""
            + started
            + "\"}";
    observedRaw(report);
    setAgentState(a1, "WORKING", OffsetDateTime.now());
    // 시작 시각보다 한참 앞선 칸 — 같은 Pod 의 되풀이 보고는 칸을 읽지도 지우지도 않으므로 그대로 남는다(WP-1409).
    slotRepo.upsert(a1, "WP", AgentState.IDLE, null, null, started.minusMinutes(10));

    observedRaw(report);

    assertThat(settingRow(a1).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("WORKING");
    assertThat(slotRepo.findAll(a1)).extracting(Slot::slotKey).containsExactly("WP");
  }

  /**
   * runner 가 새 Pod 의 시작 시각을 알리면 그보다 (30초 여유를 넘게) 앞선 옛 Pod 칸을 지우고 남은 칸으로 AI 상태를 다시 합친다(WP-1409) — 새
   * Pod 칸이 이미 쉬는 중을 보고했으면 옛 Pod 칸의 WORKING 이 남아 붙잡지 않는다. 새 Pod 칸은 지우지 않는다.
   */
  @Test
  void observed_newPodStartedAt_dropsOldPodSlotsAndReaggregates() throws Exception {
    long g = fx.generationOf(a1);
    OffsetDateTime started = OffsetDateTime.now().minusMinutes(1);
    slotRepo.upsert(a1, "", AgentState.WORKING, "WP-0", null, started.minusMinutes(10));
    slotRepo.upsert(a1, "WP", AgentState.IDLE, null, null, OffsetDateTime.now());
    // 두 칸을 합친 지금 값(옛 칸의 WORKING) — 새 Pod 칸의 보고가 시작 뒤라 관찰 UPDATE 는 지우지 않는다.
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.AGENT_STATE, "WORKING")
        .set(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY, "WP-0")
        .set(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEYS, new String[] {"WP-0"})
        .set(AGENT_RUNTIME_SETTING.AGENT_REPORTED_AT, OffsetDateTime.now())
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(a1))
        .execute();

    observedRaw(
        "{\"agentUserId\":"
            + a1
            + ",\"observedGeneration\":"
            + g
            + ",\"phase\":\"RUNNING\",\"startedAt\":\""
            + started
            + "\"}");

    var row = settingRow(a1);
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEYS)).containsExactly();
    assertThat(slotRepo.findAll(a1)).extracting(Slot::slotKey).containsExactly("WP");
  }

  /** 새 Pod 라 AI 상태를 지울 때 옛 Pod 칸도 지워져 남은 칸이 없으면 AI 상태는 지운 그대로(빈 값)다(WP-1409). */
  @Test
  void observed_newPodClearing_withNoRemainingSlots_staysCleared() throws Exception {
    long g = fx.generationOf(a1);
    OffsetDateTime started = OffsetDateTime.now();
    // 옛 Pod 칸(5분 전)만 있으면 지워지고 AI 상태도 빈 채로 남는다.
    slotRepo.upsert(a1, "", AgentState.IDLE, null, null, started.minusMinutes(5));
    setAgentState(a1, "IDLE", started.minusMinutes(5));

    observedRaw(
        "{\"agentUserId\":"
            + a1
            + ",\"observedGeneration\":"
            + g
            + ",\"phase\":\"STARTING\",\"startedAt\":\""
            + started
            + "\"}");

    assertThat(settingRow(a1).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(settingRow(a1).get(AGENT_RUNTIME_SETTING.AGENT_REPORTED_AT)).isNull();
    assertThat(slotRepo.findAll(a1)).isEmpty();
  }

  /** 지금 Pod 가 뜨기 전에 온 「쉬는 중」 보고로는 미뤄 둔 변경을 바로 적용하지 않는다(WP-1253). */
  @Test
  void desired_idleReportedBeforePodStart_doesNotApplyNow() throws Exception {
    long g = fx.generationOf(a1);
    OffsetDateTime started = OffsetDateTime.now().minusMinutes(5);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.GENERATION, g + 1)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, g)
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, "IDLE")
        .set(AGENT_RUNTIME_SETTING.STARTED_AT, started)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(a1))
        .execute();
    setAgentState(a1, "IDLE", started.minusHours(1));
    assertThat(applyNowOf(a1)).isFalse();

    setAgentState(a1, "IDLE", started.plusMinutes(1));
    assertThat(applyNowOf(a1)).isTrue();
  }

  /** 늦게 도착한 옛 generation 보고가 관찰 generation 을 되돌리지 않는다(WP-1253). */
  @Test
  void observed_staleLowerGeneration_doesNotMoveObservedGenerationBack() throws Exception {
    long g = fx.generationOf(a1);
    observed(a1, g);

    observed(a1, g - 1);

    assertThat(settingRow(a1).get(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION)).isEqualTo(g);
  }

  /**
   * desired·observed 의 쿼리 수는 AI 수와 상관없다 — managed 키·모델 연결을 AI 마다 따로 읽지 않고, observed 는 관찰 칸 갱신을 한 번의
   * 배치로 보내며 키 정리도 묶음으로 한다(WP-1253).
   */
  @Test
  void desiredAndObserved_queryCountDoesNotGrowPerAgentForKeys() throws Exception {
    RunnerPrincipal principal = new RunnerPrincipal(1L, l1);
    issueKey(a1);
    useTenant(1L);
    int fewDesired = SqlStatementCounter.count(dsl, () -> desiredService.desired(principal));
    List<Long> few = List.of(a1);
    RunnerObservedRequest fewReq = observedOf(few);
    int fewObserved =
        SqlStatementCounter.count(dsl, () -> desiredService.observed(principal, fewReq));

    TenantContext.set(1L);
    settingService.start(admin, a3);
    long a4 = fx.runningAgent(null);
    issueKey(a3);
    issueKey(a4);
    useTenant(1L);
    int manyDesired = SqlStatementCounter.count(dsl, () -> desiredService.desired(principal));
    List<Long> many = List.of(a1, a3, a4);
    RunnerObservedRequest manyReq = observedOf(many);
    int manyObserved =
        SqlStatementCounter.count(dsl, () -> desiredService.observed(principal, manyReq));

    assertThat(manyDesired).isEqualTo(fewDesired);
    assertThat(manyObserved).isEqualTo(fewObserved);
  }

  private RunnerObservedRequest observedOf(List<Long> agents) {
    return new RunnerObservedRequest(
        agents.stream()
            .map(
                id ->
                    new RunnerObservedAgent(
                        id, fx.generationOf(id), "RUNNING", null, null, null, null))
            .toList());
  }

  /**
   * 한 번 떴던 AI 를 끄고(키는 정리 유예가 지나 만료) 다시 켠 상태로 만든다 — 관찰 generation 은 옛 값으로 남는다. 다시 켠 뒤 generation 을
   * 돌려준다.
   */
  private long stopExpireAndStart(long agent) throws Exception {
    long old = issueKey(agent).get("keyId").asLong();
    setObservedGeneration(agent, fx.generationOf(agent));
    TenantContext.set(1L);
    settingService.stop(admin, agent);
    dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.EXPIRES_AT, OffsetDateTime.now().minusMinutes(1))
        .where(AGENT_API_KEY.ID.eq(old))
        .execute();
    TenantContext.set(1L);
    settingService.start(admin, agent);
    return fx.generationOf(agent);
  }

  /**
   * 끄고 다시 켠 AI 의 키 발급은 죽은 키 교체가 아니다 — 켜기가 이미 바로 적용을 걸어 runner 가 새 Pod 를 만들므로 generation 을 또 올리지
   * 않는다(다시 켤 때마다 Pod 를 두 번 만들지 않게, WP-1253).
   */
  @Test
  void issueAgentKey_afterStopAndStart_doesNotBumpGeneration() throws Exception {
    long g = stopExpireAndStart(a1);
    long before = changedEvents();

    issueKey(a1);

    assertThat(fx.generationOf(a1)).isEqualTo(g);
    assertThat(changedEvents()).isEqualTo(before);
    assertThat(applyModeOf(a1)).isEqualTo("NOW");
  }

  /**
   * 끄고 다시 켠 AI 의 새 Pod 가 관찰되기 전 재요청도 generation 을 올리지 않고 앞 키를 바꿔 준다 — 끄기 전 관찰 값은 쓰인 증거가
   * 아니다(WP-1253).
   */
  @Test
  void issueAgentKey_retryAfterStopAndStart_replacesWithoutBump() throws Exception {
    long g = stopExpireAndStart(a1);
    long first = issueKey(a1).get("keyId").asLong();
    long before = changedEvents();

    long second = issueKey(a1).get("keyId").asLong();

    assertThat(fx.generationOf(a1)).isEqualTo(g);
    assertThat(changedEvents()).isEqualTo(before);
    assertThat(expiresAtOf(first)).isBeforeOrEqualTo(OffsetDateTime.now());
    assertThat(keyService.managedChain(a1, 1L).keys())
        .extracting(ManagedKeyChain.Key::id)
        .containsExactly(second);
  }

  /**
   * 끈 뒤 정리 유예(5분) 안에 다시 켜도 키 발급은 교체가 아니다 — 끄기가 줄여 둔 키는 지워지는 Pod 의 것이라 「지금 쓰는 키」로 치지 않는다. 다시 켤 때마다 막
   * 뜬 Pod 가 바로 낡아 쉴 때 한 번 더 다시 만들어지지 않게(WP-1251 실측).
   */
  @Test
  void issueAgentKey_afterStopAndStartWithinGrace_doesNotBumpGeneration() throws Exception {
    issueKey(a1);
    setObservedGeneration(a1, fx.generationOf(a1));
    TenantContext.set(1L);
    settingService.stop(admin, a1);
    TenantContext.set(1L);
    settingService.start(admin, a1);
    long g = fx.generationOf(a1);
    long before = changedEvents();

    issueKey(a1);

    assertThat(fx.generationOf(a1)).isEqualTo(g);
    assertThat(changedEvents()).isEqualTo(before);
    assertThat(applyModeOf(a1)).isEqualTo("NOW");
  }

  /** 켜진 AI 의 실제 위치를 바꾸면 옛 위치의 Pod 는 바로 지워지므로 managed 키를 끄기처럼 정리 유예로 줄인다. */
  @Test
  void put_movingRunningAgentToAnotherLocation_shortensManagedKeysToGrace() throws Exception {
    long managedId = issueKey(a1).get("keyId").asLong();
    TenantContext.set(1L);

    settingService.put(
        admin, a1, new PutAgentRuntimeSettingRequest("claude-code", l2, Map.of(), null));

    assertRetiring(managedId);
  }

  /**
   * 다른 위치로 옮겼다가 정리 유예 안에 돌아와도 새 Pod 의 키 발급은 교체가 아니다 — 돌아온 위치의 runner 는 Secret 을 이미 지웠고 어차피 새 Pod 를
   * 만든다(WP-1251 실측: generation 이 한 번 더 올라 막 뜬 Pod 가 바로 낡았다).
   */
  @Test
  void issueAgentKey_afterMovingAwayAndBackWithinGrace_doesNotBumpGeneration() throws Exception {
    issueKey(a1);
    setObservedGeneration(a1, fx.generationOf(a1));
    TenantContext.set(1L);
    settingService.put(
        admin, a1, new PutAgentRuntimeSettingRequest("claude-code", l2, Map.of(), null));
    TenantContext.set(1L);
    settingService.put(
        admin, a1, new PutAgentRuntimeSettingRequest("claude-code", null, Map.of(), null));
    long g = fx.generationOf(a1);
    long before = changedEvents();

    issueKey(a1);

    assertThat(fx.generationOf(a1)).isEqualTo(g);
    assertThat(changedEvents()).isEqualTo(before);
  }

  /**
   * 끄고 곧 다시 켜면(runner 가 그 사이를 못 봄) 끄기가 정리 유예로 줄인 키는 desired 에 「쓸 수 있는 키」로 나오지 않는다 — 버전이 null 이라
   * runner 가 새 키를 받는다. 그 키를 그대로 쓰면 5분 뒤 만료돼 Pod 가 인증을 잃는다(코드 리뷰 지적).
   */
  @Test
  void desired_afterStopAndQuickStart_reportsNoUsableAgentKey() throws Exception {
    issueKey(a1);
    setObservedGeneration(a1, fx.generationOf(a1));
    TenantContext.set(1L);
    settingService.stop(admin, a1);
    TenantContext.set(1L);
    settingService.start(admin, a1);

    JsonNode desired = fx.json(runner(get(BASE + "/desired")).andExpect(status().isOk()));

    JsonNode key = null;
    for (JsonNode a : desired.get("agents")) {
      if (a.get("agentUserId").asLong() == a1) key = secretNamed(a.get("secrets"), "agent-key");
    }
    assertThat(key).isNotNull();
    assertThat(key.get("version").isNull()).isTrue();
    assertThat(key.get("rotateAfter").isNull()).isTrue();
  }

  /**
   * 「지금 쓰는 키」는 유예 표시(retiring_at)로만 가른다(WP-1263) — 만료가 5분 안에 오더라도 줄인 적이 없는 키는 desired 에 그대로 나오고, 같은
   * 만료라도 유예 표시가 있으면 나오지 않는다.
   */
  @Test
  void desired_usesRetiringMarkNotExpiryToPickUsableKey() throws Exception {
    long keyId = issueKey(a1).get("keyId").asLong();
    dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.EXPIRES_AT, OffsetDateTime.now().plusMinutes(3))
        .where(AGENT_API_KEY.ID.eq(keyId))
        .execute();
    assertThat(desiredAgentKeyVersion(a1)).isEqualTo(keyId);

    dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.RETIRING_AT, OffsetDateTime.now())
        .where(AGENT_API_KEY.ID.eq(keyId))
        .execute();
    assertThat(desiredAgentKeyVersion(a1)).isNull();
  }

  /** desired 에 실린 그 AI 의 agent-key 버전(없으면 null). */
  private Long desiredAgentKeyVersion(long agent) throws Exception {
    JsonNode desired = fx.json(runner(get(BASE + "/desired")).andExpect(status().isOk()));
    for (JsonNode a : desired.get("agents")) {
      if (a.get("agentUserId").asLong() == agent) {
        JsonNode version = secretNamed(a.get("secrets"), "agent-key").get("version");
        return version.isNull() ? null : version.asLong();
      }
    }
    throw new AssertionError("desired 에 AI 가 없습니다: " + agent);
  }
}
