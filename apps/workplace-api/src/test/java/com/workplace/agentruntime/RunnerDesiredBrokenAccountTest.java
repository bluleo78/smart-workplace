package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_ACCOUNT;
import static com.workplace.jooq.Tables.AGENT_ACCOUNT_BINDING;
import static com.workplace.jooq.Tables.AGENT_LOCATION;
import static com.workplace.jooq.Tables.AGENT_RUNNER_TOKEN;
import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static com.workplace.jooq.Tables.ASSISTANT_CONFIG;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentaccount.service.AgentAccountBindingService;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;

/**
 * WP-1448 리뷰 수정 — 묶인 OpenAI 호환 계정 하나의 원문을 읽지 못해도 runner desired 는 그 AI 의 login 버전만 빼고 200 으로 나간다.
 *
 * <p>테스트 트랜잭션을 쓰지 않는다(시드는 커밋하고 끝에 지운다) — 클래스에 {@code @Transactional} 을 붙이면 요청이 테스트 트랜잭션에 합류해, 안쪽
 * 트랜잭션 프록시를 지난 예외가 남긴 rollback-only 표시가 요청 안에서 드러나지 않는다(커밋 때 {@code UnexpectedRollbackException} →
 * 500). 이 테스트는 요청이 자기 트랜잭션을 열고 커밋해야 그 결함을 잡는다.
 */
class RunnerDesiredBrokenAccountTest extends IntegrationTestBase {

  private static final String RUNNER = "/api/v1/agent-runtime/runner";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AssistantConfigRepository configRepo;
  @Autowired AgentAccountService accountService;
  @Autowired AgentAccountBindingService bindingService;
  @Autowired AgentAccountRepository accounts;

  private long admin;
  private long locationId;
  private String runnerToken;
  private final List<Long> agents = new ArrayList<>();
  private final List<Long> accountIds = new ArrayList<>();

  @BeforeEach
  void seed() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    callInTenant(
        1L,
        () -> {
          admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
          TestFixtures.grantRole(dsl, admin, "ADMIN");
          var created =
              locationService.create(
                  admin, new CreateAgentLocationRequest("BROKEN-" + suffix, null, 5));
          locationId = created.location().id();
          runnerToken = created.plaintextToken();
          return null;
        });
  }

  @AfterEach
  void cleanup() {
    List<Long> users = new ArrayList<>(agents);
    users.add(admin);
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(AGENT_ACCOUNT_BINDING)
              .where(AGENT_ACCOUNT_BINDING.AGENT_USER_ID.in(agents))
              .execute();
          dsl.deleteFrom(AGENT_ACCOUNT).where(AGENT_ACCOUNT.ID.in(accountIds)).execute();
          dsl.deleteFrom(AGENT_RUNTIME_SETTING)
              .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.in(agents))
              .execute();
          dsl.deleteFrom(ASSISTANT_CONFIG)
              .where(ASSISTANT_CONFIG.AGENT_USER_ID.in(agents))
              .execute();
          dsl.deleteFrom(AGENT_RUNNER_TOKEN)
              .where(AGENT_RUNNER_TOKEN.LOCATION_ID.eq(locationId))
              .execute();
          dsl.deleteFrom(AGENT_LOCATION).where(AGENT_LOCATION.ID.eq(locationId)).execute();
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
        });
    TenantContext.clear();
  }

  // ---- 준비 도우미(모두 커밋된다) ----

  /** 템플릿 실행 설정을 둔 AI 를 계정에 묶고, 원하는 상태를 RUN 으로 바로 바꾼다(켜기 전 확인은 이 테스트의 관심이 아니다). */
  private long runningBoundAgent(String template, long accountId, String model) {
    long agent =
        callInTenant(
            1L,
            () -> {
              long id =
                  TestFixtures.activeMemberOfCurrentTenant(
                      dsl, TestFixtures.createAgentNoToken(dsl));
              settingService.put(
                  admin,
                  id,
                  new PutAgentRuntimeSettingRequest(template, locationId, Map.of(), null));
              return id;
            });
    agents.add(agent);
    callInTenant(
        1L,
        () -> {
          if (model != null) configRepo.upsert(agent, model, null, null, null);
          bindingService.bind(admin, agent, accountId);
          dsl.update(AGENT_RUNTIME_SETTING)
              .set(AGENT_RUNTIME_SETTING.DESIRED, "RUN")
              .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
              .execute();
          return null;
        });
    return agent;
  }

  private long opencodeAccount(String apiKey) {
    long id =
        callInTenant(
            1L,
            () ->
                accountService
                    .register(
                        admin,
                        new AgentAccountRequest(
                            "opencode",
                            null,
                            new ProviderConfig(
                                "vllm",
                                null,
                                Map.of("baseURL", "https://api.example.com/v1", "apiKey", apiKey)),
                            null,
                            null))
                    .id());
    accountIds.add(id);
    return id;
  }

  private long anthropicAccount() {
    long id =
        callInTenant(
            1L,
            () ->
                accountService
                    .register(
                        admin,
                        new AgentAccountRequest(
                            "anthropic", "sk-ant-oat01-" + "D".repeat(40), null, null, null))
                    .id());
    accountIds.add(id);
    return id;
  }

  private long secretVersion(long accountId) {
    return callInTenant(1L, () -> accounts.findActive(accountId).orElseThrow().secretVersion());
  }

  /** 계정 암호문을 복호화할 수 없는 값으로 바꾼다 — 키가 바뀌었거나 저장값이 깨진 상황. */
  private void breakSecret(long accountId) {
    callInTenant(
        1L,
        () ->
            dsl.update(AGENT_ACCOUNT)
                .set(AGENT_ACCOUNT.ENCRYPTED_SECRET, "broken-not-base64")
                .where(AGENT_ACCOUNT.ID.eq(accountId))
                .execute());
  }

  /** desired 를 부른다 — 요청은 테스트 트랜잭션 없이 자기 트랜잭션을 열고 커밋한다. AI id → 비밀값 이름 → 버전(null 가능). */
  private Map<Long, Map<String, JsonNode>> desired() throws Exception {
    TenantContext.set(1L);
    String body =
        mvc.perform(get(RUNNER + "/desired").header("Authorization", "Bearer " + runnerToken))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    Map<Long, Map<String, JsonNode>> out = new HashMap<>();
    for (JsonNode a : om.readTree(body).get("agents")) {
      Map<String, JsonNode> secrets = new HashMap<>();
      for (JsonNode s : a.get("secrets")) secrets.put(s.get("name").asText(), s.get("version"));
      out.put(a.get("agentUserId").asLong(), secrets);
    }
    return out;
  }

  @Test
  void brokenBoundOpencodeAccountDropsOnlyThatAgentsLoginVersion() throws Exception {
    long brokenAcc = opencodeAccount("sk-fake-broken");
    long okAcc = opencodeAccount("sk-fake-ok");
    long claudeAcc = anthropicAccount();
    long broken = runningBoundAgent("opencode", brokenAcc, "vllm/qwen3");
    long healthy = runningBoundAgent("opencode", okAcc, "vllm/qwen3");
    long claude = runningBoundAgent("claude-code", claudeAcc, null);
    breakSecret(brokenAcc);

    Map<Long, Map<String, JsonNode>> agentsOut = desired();

    // 위치의 AI 목록은 그대로 나간다 — 깨진 계정의 AI 도 빠지지 않고 login 버전만 없다(활성 연결의 원문 실패와 같은 모양).
    assertThat(agentsOut).containsKeys(broken, healthy, claude);
    assertThat(agentsOut.get(broken).get("login").isNull()).isTrue();
    assertThat(agentsOut.get(healthy).get("login").isNull()).isFalse();
    assertThat(agentsOut.get(claude).get("claude").asLong()).isEqualTo(secretVersion(claudeAcc));

    // 정상 OpenAI 호환 AI 의 버전은 /secrets/login 의 버전과 같다(runner 가 매 회차 다시 받지 않게).
    TenantContext.set(1L);
    JsonNode login =
        om.readTree(
            mvc.perform(
                    get(RUNNER + "/agents/" + healthy + "/secrets/login")
                        .header("Authorization", "Bearer " + runnerToken))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    assertThat(login.get("version").asLong())
        .isEqualTo(agentsOut.get(healthy).get("login").asLong());
  }
}
