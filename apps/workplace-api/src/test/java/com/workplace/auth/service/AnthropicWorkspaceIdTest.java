package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.dto.AgentAccountUpdateRequest;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import com.workplace.auth.outbound.AiAgentModelsClient;
import com.workplace.auth.outbound.AiAgentModelsClient.CredentialCheck;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.hamcrest.Matchers;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
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
 * WP-1496 Anthropic 워크스페이스 ID 통합 테스트(개정 스펙) — 워크스페이스 ID 는 모든 Claude 토큰에 선택이고 주면 키 종류와 상관없이 저장한다.
 * 등록(개인 비서·관리자 연결·AI 계정 생성/토큰 교체) 때마다 ai-agent 모델 조회로 키를 시험해 「워크스페이스 ID 필요」·「거절」이면 저장하지 않고(400),
 * ai-agent 장애면 저장한다. ai-agent 모델 조회는 {@link AiAgentModelsClient} 목으로 대신한다. 키 값은 모두 가짜다.
 */
@Transactional
class AnthropicWorkspaceIdTest extends ExternalClientMockedTestBase {

  private static final String USR = "sk-ant-usr01-" + "U".repeat(40);
  private static final String USR2 = "sk-ant-usr01-" + "V".repeat(40);
  private static final String OAT = "sk-ant-oat01-" + "O".repeat(40);
  private static final String WS = "wrkspc_01ABCdef";

  /** workspace_required 때 errors.workspaceId·message 로 내는 안내(웹이 ID 칸 옆에 보인다). */
  private static final String WORKSPACE_REQUIRED_TEXT =
      "이 키는 Anthropic 워크스페이스 ID 가 필요합니다 — Anthropic 콘솔 Workspaces 에서 확인해 넣어 주세요";

  /** workspace_invalid(키에 맞지 않는 워크스페이스 ID) 때 errors.workspaceId·message 로 내는 안내. */
  private static final String WORKSPACE_INVALID_TEXT =
      "이 워크스페이스 ID 를 Anthropic 이 받지 않았어요 — 키가 속한 워크스페이스의 ID 인지 Anthropic 콘솔 Workspaces 에서"
          + " 확인해 주세요";

  @Autowired DSLContext dsl;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired AiAgentCredentialService service;
  @Autowired AiAgentCredentialRepository repo;
  @Autowired AgentAccountService accountService;
  @Autowired AgentAccountRepository accounts;
  @Autowired PersonalAssistantRepository personalRepo;
  @Autowired AiAgentModelsClient modelsClient;

  private long admin;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    // 기본은 ai-agent 가 키를 받아들인다 — 필요·거절·장애는 테스트마다 덧쓴다.
    when(modelsClient.checkAnthropicCredential(any(), any())).thenReturn(CredentialCheck.ACCEPTED);
  }

  @AfterEach
  void clear() {
    TenantContext.clear();
  }

  private long newAgent() {
    return TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
  }

  // ── 선택 저장: 키 종류와 상관없이 ──────────────────────────────────────

  @Test
  void oatKeyStoresTrimmedWorkspaceIdAndIsChecked() {
    long agent = newAgent();

    service.register(admin, agent, "anthropic", OAT, "oat", null, "  " + WS + "  ");

    assertThat(repo.findActive(agent).orElseThrow().workspaceId()).isEqualTo(WS);
    assertThat(service.redeemSelf(agent).workspaceId()).isEqualTo(WS);
    assertThat(service.findActiveSecret(agent).orElseThrow().workspaceId()).isEqualTo(WS);
    // 구독 토큰도 등록 확인을 한다 — 정리한 워크스페이스 ID 로 한 번.
    verify(modelsClient, times(1)).checkAnthropicCredential(OAT, WS);
  }

  @Test
  void usrKeyStoresWorkspaceIdAndRedeemReturnsIt() {
    long agent = newAgent();

    service.register(admin, agent, "anthropic", USR, "usr", null, WS);

    var redeem = service.redeemSelf(agent);
    assertThat(redeem.token()).isEqualTo(USR);
    assertThat(redeem.workspaceId()).isEqualTo(WS);
    verify(modelsClient, times(1)).checkAnthropicCredential(USR, WS);
  }

  @Test
  void blankWorkspaceIdIsStoredAsNullForAnyKey() {
    // 접두로 필수 여부를 정하지 않는다 — usr 키도 워크스페이스 ID 없이 저장된다(필요하면 확인이 알린다).
    for (String token : new String[] {USR, OAT}) {
      for (String ws : new String[] {null, "", "   "}) {
        long agent = newAgent();
        service.register(admin, agent, "anthropic", token, null, null, ws);
        assertThat(repo.findActive(agent).orElseThrow().workspaceId()).isNull();
        assertThat(service.redeemSelf(agent).workspaceId()).isNull();
      }
    }
    verify(modelsClient, times(3)).checkAnthropicCredential(USR, null);
    verify(modelsClient, times(3)).checkAnthropicCredential(OAT, null);
  }

  @Test
  void malformedWorkspaceIdIsRejectedForAnyKey() {
    long agent = newAgent();
    for (String token : new String[] {USR, OAT}) {
      for (String ws :
          new String[] {
            "wrkspc_a\nX-Evil: 1",
            "wrkspc a",
            "wrkspc_a\tb",
            "w".repeat(129),
            // 비 ASCII — 전각 문자·폭 없는 이음자(U+200D)도 헤더 값으로 받지 않는다(ai-agent·웹과 같은 규칙).
            "wrkspc_\uFF21",
            "wrkspc_a\u200Db"
          }) {
        assertThatThrownBy(() -> service.register(admin, agent, "anthropic", token, null, null, ws))
            .isInstanceOf(InvalidProviderCredentialException.class)
            .hasMessageContaining("워크스페이스 ID");
      }
    }
    assertThat(repo.findActive(agent)).isEmpty();
    // 형식이 틀리면 ai-agent 에 묻지도 않는다.
    verify(modelsClient, never()).checkAnthropicCredential(any(), any());
    // 128자는 받는다(경계).
    service.register(admin, agent, "anthropic", USR, null, null, "w".repeat(128));
    assertThat(repo.findActive(agent).orElseThrow().workspaceId()).hasSize(128);
  }

  // ── 등록 확인 결과 ──────────────────────────────────────────────────

  @Test
  void workspaceRequiredIs400WithFieldErrorAndKeepsPreviousConnection() {
    long agent = newAgent();
    service.register(admin, agent, "anthropic", OAT, "old", null, null);
    when(modelsClient.checkAnthropicCredential(USR, null))
        .thenReturn(CredentialCheck.WORKSPACE_REQUIRED);

    assertThatThrownBy(() -> service.register(admin, agent, "anthropic", USR, "new", null, null))
        .isInstanceOfSatisfying(
            InvalidProviderCredentialException.class,
            e -> {
              assertThat(e.getMessage()).isEqualTo(WORKSPACE_REQUIRED_TEXT);
              assertThat(e.getErrors()).containsEntry("workspaceId", WORKSPACE_REQUIRED_TEXT);
            });

    // 확인은 저장 전에 한다 — 기존 연결이 회수되지 않고 남는다.
    assertThat(repo.findActive(agent).orElseThrow().label()).isEqualTo("old");
  }

  @Test
  void workspaceInvalidIs400WithFieldErrorAndKeepsPreviousConnection() {
    long agent = newAgent();
    service.register(admin, agent, "anthropic", OAT, "old", null, null);
    when(modelsClient.checkAnthropicCredential(USR, "wrkspc_wrong"))
        .thenReturn(CredentialCheck.WORKSPACE_INVALID);

    assertThatThrownBy(
            () -> service.register(admin, agent, "anthropic", USR, "new", null, "wrkspc_wrong"))
        .isInstanceOfSatisfying(
            InvalidProviderCredentialException.class,
            e -> {
              assertThat(e.getMessage()).isEqualTo(WORKSPACE_INVALID_TEXT);
              assertThat(e.getErrors()).containsEntry("workspaceId", WORKSPACE_INVALID_TEXT);
            });

    // 틀린 ID 는 저장하지 않는다 — 기존 연결이 그대로 남는다.
    var active = repo.findActive(agent).orElseThrow();
    assertThat(active.label()).isEqualTo("old");
    assertThat(active.workspaceId()).isNull();
  }

  @Test
  void credentialRejectedIs400AndNotSaved() {
    long agent = newAgent();
    when(modelsClient.checkAnthropicCredential(USR, WS)).thenReturn(CredentialCheck.REJECTED);

    assertThatThrownBy(() -> service.register(admin, agent, "anthropic", USR, null, null, WS))
        .isInstanceOf(InvalidProviderCredentialException.class)
        .hasMessageContaining("받아들이지 않았어요")
        .satisfies(e -> assertThat(e.getMessage()).doesNotContain(USR));
    assertThat(repo.findActive(agent)).isEmpty();
  }

  @Test
  void savedWhenAiAgentUnavailableOrUnknown() {
    long agent = newAgent();
    when(modelsClient.checkAnthropicCredential(USR, WS)).thenReturn(CredentialCheck.UNAVAILABLE);
    service.register(admin, agent, "anthropic", USR, null, null, WS);
    assertThat(repo.findActive(agent).orElseThrow().workspaceId()).isEqualTo(WS);

    // 목이 답을 주지 않아도(null) 막지 않는다 — 모름은 저장.
    long other = newAgent();
    when(modelsClient.checkAnthropicCredential(OAT, null)).thenReturn(null);
    service.register(admin, other, "anthropic", OAT, null, null, null);
    assertThat(repo.findActive(other)).isPresent();
  }

  // ── HTTP: 개인 비서·관리자 연결 ────────────────────────────────────────

  private ResultActions call(MockHttpServletRequestBuilder b, Authentication auth)
      throws Exception {
    TenantContext.set(1L);
    ResultActions r = mvc.perform(b.with(authentication(auth)));
    TenantContext.set(1L);
    return r;
  }

  private Authentication adminAuth() {
    return WebSessionAuth.of(admin, List.of(new SimpleGrantedAuthority("user:write")));
  }

  private static Map<String, Object> body(Object... kv) {
    Map<String, Object> m = new HashMap<>();
    for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
    return m;
  }

  @Test
  void personalAssistantWorkspaceRequiredReturnsFieldError() throws Exception {
    long human = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    Authentication me = WebSessionAuth.of(human, List.of());
    when(modelsClient.checkAnthropicCredential(USR, null))
        .thenReturn(CredentialCheck.WORKSPACE_REQUIRED);

    call(
            put("/api/v1/users/me/assistant/credential")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body("token", USR, "label", "내 키"))),
            me)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(WORKSPACE_REQUIRED_TEXT))
        .andExpect(jsonPath("$.errors.workspaceId").value(WORKSPACE_REQUIRED_TEXT));

    call(
            put("/api/v1/users/me/assistant/credential")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    om.writeValueAsString(body("token", USR, "label", "내 키", "workspaceId", WS))),
            me)
        .andExpect(status().isNoContent());

    long agent = personalRepo.findAgentId(human).orElseThrow();
    assertThat(service.redeemSelf(agent).workspaceId()).isEqualTo(WS);
  }

  @Test
  void personalAssistantWorkspaceInvalidReturnsFieldError() throws Exception {
    long human = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    Authentication me = WebSessionAuth.of(human, List.of());
    when(modelsClient.checkAnthropicCredential(USR, "wrkspc_wrong"))
        .thenReturn(CredentialCheck.WORKSPACE_INVALID);

    call(
            put("/api/v1/users/me/assistant/credential")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    om.writeValueAsString(
                        body("token", USR, "label", "내 키", "workspaceId", "wrkspc_wrong"))),
            me)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(WORKSPACE_INVALID_TEXT))
        .andExpect(jsonPath("$.errors.workspaceId").value(WORKSPACE_INVALID_TEXT));

    // 저장되지 않았다 — 개인 비서 연결이 생기지 않는다.
    assertThat(personalRepo.findAgentId(human).flatMap(repo::findActive)).isEmpty();
  }

  @Test
  void personalAssistantRejectedKeyIs400() throws Exception {
    long human = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    when(modelsClient.checkAnthropicCredential(OAT, null)).thenReturn(CredentialCheck.REJECTED);

    call(
            put("/api/v1/users/me/assistant/credential")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body("token", OAT))),
            WebSessionAuth.of(human, List.of()))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(Matchers.containsString("받아들이지 않았어요")))
        .andExpect(jsonPath("$.errors").doesNotExist());
  }

  @Test
  void adminConnectionWorkspaceIdIsOptional() throws Exception {
    long agent = newAgent();
    String url = "/api/v1/admin/agents/" + agent + "/provider-credential";

    // usr 키도 워크스페이스 ID 없이 등록된다(확인이 받아들이면).
    call(
            post(url)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body("token", USR, "label", "t"))),
            adminAuth())
        .andExpect(status().isCreated());
    assertThat(repo.findActive(agent).orElseThrow().workspaceId()).isNull();

    call(
            post(url)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    om.writeValueAsString(body("token", OAT, "label", "t", "workspaceId", WS))),
            adminAuth())
        .andExpect(status().isCreated());
    assertThat(repo.findActive(agent).orElseThrow().workspaceId()).isEqualTo(WS);

    call(
            post(url)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body("token", OAT, "workspaceId", "bad\nvalue"))),
            adminAuth())
        .andExpect(status().isBadRequest());
  }

  // ── AI 계정(agent_account) ─────────────────────────────────────────

  @Test
  void agentAccountStoresWorkspaceIdAndLabelOnlyUpdateKeepsItWithoutCheck() {
    long id =
        accountService
            .register(admin, new AgentAccountRequest("anthropic", OAT, null, "팀 키", null, WS))
            .id();
    assertThat(accounts.findActive(id).orElseThrow().workspaceId()).isEqualTo(WS);
    verify(modelsClient, times(1)).checkAnthropicCredential(OAT, WS);

    // 라벨만 — workspaceId 를 함께 보내도 토큰이 없으면 의미가 없다(유지). 확인도 하지 않는다.
    accountService.update(
        admin, id, new AgentAccountUpdateRequest("새 이름", null, null, null, "wrkspc_other"));
    assertThat(accounts.findActive(id).orElseThrow().workspaceId()).isEqualTo(WS);
    verify(modelsClient, times(1)).checkAnthropicCredential(any(), any());

    // 다른 키 + 새 워크스페이스로 교체 → 새 값(확인 한 번 더).
    accountService.update(
        admin, id, new AgentAccountUpdateRequest(null, USR2, null, null, "wrkspc_two"));
    assertThat(accounts.findActive(id).orElseThrow().workspaceId()).isEqualTo("wrkspc_two");
    verify(modelsClient, times(1)).checkAnthropicCredential(USR2, "wrkspc_two");

    // 워크스페이스 ID 없이 교체 → null.
    accountService.update(admin, id, new AgentAccountUpdateRequest(null, USR, null, null, null));
    assertThat(accounts.findActive(id).orElseThrow().workspaceId()).isNull();
  }

  @Test
  void agentAccountRegisterWorkspaceRequiredOrRejectedIsNotSaved() {
    when(modelsClient.checkAnthropicCredential(USR, null))
        .thenReturn(CredentialCheck.WORKSPACE_REQUIRED);
    assertThatThrownBy(
            () ->
                accountService.register(
                    admin, new AgentAccountRequest("anthropic", USR, null, null, null, null)))
        .isInstanceOfSatisfying(
            InvalidProviderCredentialException.class,
            e -> assertThat(e.getErrors()).containsKey("workspaceId"));

    when(modelsClient.checkAnthropicCredential(USR, WS)).thenReturn(CredentialCheck.REJECTED);
    assertThatThrownBy(
            () ->
                accountService.register(
                    admin, new AgentAccountRequest("anthropic", USR, null, null, null, WS)))
        .isInstanceOf(InvalidProviderCredentialException.class);
    assertThat(accounts.findAllActive()).isEmpty();

    when(modelsClient.checkAnthropicCredential(USR, WS)).thenReturn(CredentialCheck.UNAVAILABLE);
    long id =
        accountService
            .register(admin, new AgentAccountRequest("anthropic", USR, null, null, null, WS))
            .id();
    assertThat(accounts.findActive(id).orElseThrow().workspaceId()).isEqualTo(WS);
  }

  @Test
  void agentAccountMalformedWorkspaceIdIs400() {
    assertThatThrownBy(
            () ->
                accountService.register(
                    admin, new AgentAccountRequest("anthropic", OAT, null, null, null, "a b")))
        .isInstanceOf(InvalidProviderCredentialException.class);
    verify(modelsClient, never()).checkAnthropicCredential(any(), any());
  }

  @Test
  void agentAccountUpdateWorkspaceRequiredKeepsOldSecret() {
    long id =
        accountService
            .register(admin, new AgentAccountRequest("anthropic", USR, null, null, null, WS))
            .id();
    long version = accounts.findActive(id).orElseThrow().secretVersion();
    when(modelsClient.checkAnthropicCredential(USR2, null))
        .thenReturn(CredentialCheck.WORKSPACE_REQUIRED);

    assertThatThrownBy(
            () ->
                accountService.update(
                    admin, id, new AgentAccountUpdateRequest(null, USR2, null, null, null)))
        .isInstanceOf(InvalidProviderCredentialException.class);
    assertThat(accounts.findActive(id).orElseThrow().secretVersion()).isEqualTo(version);
    assertThat(accounts.findActive(id).orElseThrow().workspaceId()).isEqualTo(WS);
  }

  @Test
  void legacyBridgeCarriesWorkspaceIdAndUpdatesItForSameKey() {
    long id = accountService.findOrRegisterFromLegacy(admin, "anthropic", OAT, null, true, WS);
    assertThat(accounts.findActive(id).orElseThrow().workspaceId()).isEqualTo(WS);

    // 같은 키(지문)로 워크스페이스만 바꿔 다시 넣으면 같은 계정의 값이 바뀐다.
    long again =
        accountService.findOrRegisterFromLegacy(admin, "anthropic", OAT, null, true, "wrkspc_two");
    assertThat(again).isEqualTo(id);
    assertThat(accounts.findActive(id).orElseThrow().workspaceId()).isEqualTo("wrkspc_two");
    // 다리는 다시 확인하지 않는다(연결 등록이 이미 확인했다).
    verify(modelsClient, never()).checkAnthropicCredential(any(), any());
  }

  @Test
  void agentAccountHttpWorkspaceRequiredThenRegisterAndLabelOnlyPatch() throws Exception {
    String base = "/api/v1/admin/agent-accounts";
    when(modelsClient.checkAnthropicCredential(USR, null))
        .thenReturn(CredentialCheck.WORKSPACE_REQUIRED);
    call(
            post(base)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body("provider", "anthropic", "token", USR))),
            adminAuth())
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.workspaceId").value(WORKSPACE_REQUIRED_TEXT));

    String res =
        call(
                post(base)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        om.writeValueAsString(
                            body("provider", "anthropic", "token", USR, "workspaceId", WS))),
                adminAuth())
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    long id = om.readTree(res).get("id").asLong();
    assertThat(accounts.findActive(id).orElseThrow().workspaceId()).isEqualTo(WS);

    call(
            patch(base + "/" + id)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body("label", "이름만"))),
            adminAuth())
        .andExpect(status().isOk());
    assertThat(accounts.findActive(id).orElseThrow().workspaceId()).isEqualTo(WS);
  }
}
