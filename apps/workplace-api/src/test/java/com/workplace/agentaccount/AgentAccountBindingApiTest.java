package com.workplace.agentaccount;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1448 AI → 계정 묶기 관리자 API 통합 테스트 — 작업 공간(Pod) AI 를 템플릿에 맞는 계정에 묶고(조회 포함), 실행 설정 없는 AI(409)·맞지 않는
 * 종류(400)·개인 비서(400)·다른 워크스페이스 계정(404)을 거절하며, 풀기는 멱등(204)이다. 키 값은 모두 가짜다.
 */
@Transactional
class AgentAccountBindingApiTest extends IntegrationTestBase {

  private static final String TOKEN = "sk-ant-oat01-" + "B".repeat(40);

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired AgentAccountService accountService;
  @Autowired AgentAccountRepository accounts;
  @Autowired AgentRuntimeSettingService settingService;

  private long admin;

  /** 워크스페이스 1 의 관리자를 시드한다. */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
  }

  private static String url(long agent) {
    return "/api/v1/admin/agents/" + agent + "/agent-account";
  }

  /** 웹 로그인 세션 인증(user:write) — 쓰기 API 가 @RequireWebSession 이다. */
  private Authentication auth() {
    return WebSessionAuth.of(admin, List.of(new SimpleGrantedAuthority("user:write")));
  }

  /** 요청 필터가 끝나면 TenantContext 가 비워지므로 매 호출 전·후에 테넌트를 다시 맞춘다. */
  private ResultActions call(MockHttpServletRequestBuilder b) throws Exception {
    useTenant(1L);
    ResultActions r = mvc.perform(b.with(authentication(auth())));
    useTenant(1L);
    return r;
  }

  private ResultActions bind(long agent, long accountId) throws Exception {
    return call(
        put(url(agent))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"accountId\":" + accountId + "}"));
  }

  /** 이 워크스페이스 AI 를 만든다 — template 이 null 이면 실행 설정을 두지 않는다(기본 방식). */
  private long newAgent(String template) {
    useTenant(1L);
    long agent =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    if (template != null) {
      settingService.put(
          admin, agent, new PutAgentRuntimeSettingRequest(template, null, Map.of(), null));
    }
    return agent;
  }

  private long anthropicAccount() {
    return accountService
        .register(admin, new AgentAccountRequest("anthropic", TOKEN, null, "팀 구독", null))
        .id();
  }

  @Test
  void bindPodAgentToFittingAccount() throws Exception {
    long agent = newAgent("claude-code");
    long acc = anthropicAccount();

    bind(agent, acc)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(acc))
        .andExpect(jsonPath("$.agents[0].userId").value(agent));

    call(get(url(agent)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(acc))
        .andExpect(jsonPath("$.provider").value("anthropic"));
  }

  @Test
  void bindRequiresPodMode() throws Exception {
    long agent = newAgent(null);
    long acc = anthropicAccount();

    bind(agent, acc)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("작업 공간 실행 방식 AI 만 계정을 고를 수 있어요"));
    call(get(url(agent))).andExpect(status().isNotFound());
  }

  @Test
  void bindRejectsUnfitProvider() throws Exception {
    long agent = newAgent("test-chatgpt");
    long acc = anthropicAccount();

    bind(agent, acc)
        .andExpect(status().isBadRequest())
        .andExpect(
            jsonPath("$.message").value("이 AI 의 실행 템플릿은 「ChatGPT 로그인」 계정을 써요 — 그 계정으로 연결해 주세요."));
  }

  @Test
  void bindPersonalAssistantRejected() throws Exception {
    useTenant(1L);
    long assistant =
        TestFixtures.activeMemberOfCurrentTenant(
            dsl, TestFixtures.createPersonalAssistant(dsl, admin));
    long acc = anthropicAccount();

    bind(assistant, acc).andExpect(status().isBadRequest());
  }

  @Test
  void bindOtherTenantAccountIsNotFound() throws Exception {
    long agent = newAgent("claude-code");
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    useTenant(tenant2);
    long foreign =
        accounts.insert("anthropic", "남의 계정", "iv:cipher", null, null, "ACTIVE", null, null);
    useTenant(1L);

    bind(agent, foreign)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("AGENT_ACCOUNT_NOT_FOUND"));
    call(get(url(agent))).andExpect(status().isNotFound());
  }

  @Test
  void unbindIsIdempotent() throws Exception {
    long agent = newAgent("claude-code");
    long acc = anthropicAccount();
    bind(agent, acc).andExpect(status().isOk());

    call(delete(url(agent))).andExpect(status().isNoContent());
    call(delete(url(agent))).andExpect(status().isNoContent());

    call(get(url(agent)))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("AGENT_ACCOUNT_NOT_BOUND"));
  }
}
