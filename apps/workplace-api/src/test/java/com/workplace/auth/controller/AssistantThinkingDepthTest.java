package com.workplace.auth.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.service.AssistantDefaults;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1322 — 「생각의 깊이」 값이 모델 추론 노력 단계(DEFAULT·LOW~MAX)로 바뀌었다.
 *
 * <p>검증: 새 값은 저장·조회되고 옛 값(NONE/NORMAL/DEEP)은 연결 provider 로 새 값으로 바꿔 저장(옛 웹 화면 호환), 엉뚱한 값은 400, 연결
 * provider 가 바뀌면 DEFAULT 로 되돌림, 미설정 기본은 DEFAULT, V263 이관 문장이 연결 provider 별로 옛 값을 옮긴다(Claude 는
 * LOW/HIGH/MAX, 그 외는 DEFAULT). 이관은 Flyway 가 이미 돌았으므로 마이그레이션 파일의 마커 사이 문장을 시드 위에 다시
 * 돌린다(AiMemoryCleanupMigrationTest 와 같은 방식).
 */
@Transactional
class AssistantThinkingDepthTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired AssistantConfigRepository configRepo;
  @Autowired AiAgentCredentialRepository credentialRepo;
  @Autowired AssistantResolver resolver;

  /** 개인 비서 등록은 신규 AGENT 멤버십에 active 테넌트가 필요하다(MyAssistantControllerTest 와 같음). */
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private UsernamePasswordAuthenticationToken auth(long userId) {
    return new UsernamePasswordAuthenticationToken(userId, "n/a", List.of());
  }

  /** Claude 토큰으로 개인 비서를 등록한 사용자. */
  private long humanWithAssistant() throws Exception {
    long human = TestFixtures.createHuman(dsl);
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(auth(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + "X".repeat(64) + "\",\"label\":\"t\"}"))
        .andExpect(status().isNoContent());
    return human;
  }

  private ResultActions putDepth(long human, String depth) throws Exception {
    return mvc.perform(
        put("/api/v1/users/me/assistant/settings")
            .with(authentication(auth(human)))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"thinkingDepth\":\"" + depth + "\"}"));
  }

  @Test
  void 새_단계는_저장되고_상태에_그대로_보인다() throws Exception {
    long human = humanWithAssistant();
    for (String depth : List.of("DEFAULT", "LOW", "MEDIUM", "HIGH", "XHIGH", "MAX")) {
      putDepth(human, depth).andExpect(status().isNoContent());
      mvc.perform(get("/api/v1/users/me/assistant").with(authentication(auth(human))))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.thinkingDepth").value(depth));
    }
  }

  /** OpenAI 호환(opencode) 연결로 개인 비서를 등록(또는 교체)한다. */
  private void registerOpencode(long human) throws Exception {
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(auth(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"provider\":\"opencode\",\"model\":\"openai/gpt-5\",\"providerConfig\":"
                        + "{\"providerId\":\"openai\",\"options\":{\"baseURL\":\"https://api.example.com/v1\","
                        + "\"apiKey\":\"sk-x\"}}}"))
        .andExpect(status().isNoContent());
  }

  /** Claude 토큰으로 개인 비서를 등록(또는 교체)한다. */
  private void registerClaude(long human) throws Exception {
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(auth(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + "Y".repeat(64) + "\",\"label\":\"t\"}"))
        .andExpect(status().isNoContent());
  }

  private ResultActions depthIs(long human, String depth) throws Exception {
    return mvc.perform(get("/api/v1/users/me/assistant").with(authentication(auth(human))))
        .andExpect(jsonPath("$.thinkingDepth").value(depth));
  }

  @Test // 옛 웹 화면 호환(한 릴리스): 옛 값은 받되 V263 규칙으로 새 값으로 바꿔 저장한다 — Claude 연결
  void 옛_값은_Claude_연결이면_LOW_HIGH_MAX_로_저장된다() throws Exception {
    long human = humanWithAssistant();
    putDepth(human, "NONE").andExpect(status().isNoContent());
    depthIs(human, "LOW");
    putDepth(human, "NORMAL").andExpect(status().isNoContent());
    depthIs(human, "HIGH");
    putDepth(human, "DEEP").andExpect(status().isNoContent());
    depthIs(human, "MAX");
  }

  @Test
  void 옛_값은_OpenAI_호환_연결이면_DEFAULT_로_저장된다() throws Exception {
    long human = TestFixtures.createHuman(dsl);
    registerOpencode(human);
    putDepth(human, "DEEP").andExpect(status().isNoContent());
    depthIs(human, "DEFAULT");
  }

  @Test
  void 엉뚱한_값은_400_이고_저장값은_그대로다() throws Exception {
    long human = humanWithAssistant();
    putDepth(human, "HIGH").andExpect(status().isNoContent());
    for (String bad : List.of("high", "ULTRA", "normal")) {
      putDepth(human, bad).andExpect(status().isBadRequest());
    }
    depthIs(human, "HIGH");
  }

  @Test // provider 마다 받는 단계가 달라 — 연결 provider 가 바뀌면 생각의 깊이를 설정 안 함으로 되돌린다
  void 다른_provider_로_연결을_바꾸면_DEFAULT_로_되돌리고_같은_provider_면_그대로다() throws Exception {
    long human = humanWithAssistant();
    putDepth(human, "HIGH").andExpect(status().isNoContent());
    registerClaude(human); // 같은 provider 재연결(토큰 교체) — 유지
    depthIs(human, "HIGH");
    registerOpencode(human); // Claude → OpenAI 호환
    depthIs(human, "DEFAULT");
    putDepth(human, "LOW").andExpect(status().isNoContent());
    registerClaude(human); // OpenAI 호환 → Claude
    depthIs(human, "DEFAULT");
  }

  @Test // 이슈 재현 경로: 연결 해제(회수) 뒤 다른 provider 로 등록해도 provider 가 바뀐 것으로 본다
  void 연결_해제_뒤_다른_provider_로_등록해도_DEFAULT_로_되돌린다() throws Exception {
    long human = TestFixtures.createHuman(dsl);
    registerOpencode(human);
    putDepth(human, "MEDIUM").andExpect(status().isNoContent());
    mvc.perform(delete("/api/v1/users/me/assistant").with(authentication(auth(human))))
        .andExpect(status().is2xxSuccessful());
    registerClaude(human);
    depthIs(human, "DEFAULT");
  }

  @Test
  void 미설정이면_실행_사양의_기본은_DEFAULT_다() throws Exception {
    long human = humanWithAssistant();
    assertThat(AssistantDefaults.THINKING_DEPTH).isEqualTo("DEFAULT");
    assertThat(resolver.resolve(human).thinkingDepth()).isEqualTo("DEFAULT");
  }

  /** V263 의 이관 문장 — `-- @wp1322-migrate-begin` 줄 다음부터 `-- @wp1322-migrate-end` 앞까지(끝 세미콜론 제외). */
  private static String migrateSql() throws IOException {
    String all =
        new ClassPathResource("db/migration/V263__assistant_thinking_depth_effort_levels.sql")
            .getContentAsString(StandardCharsets.UTF_8);
    int begin = all.indexOf("-- @wp1322-migrate-begin");
    int end = all.indexOf("-- @wp1322-migrate-end");
    String body = all.substring(all.indexOf('\n', begin) + 1, end).strip();
    return body.endsWith(";") ? body.substring(0, body.length() - 1) : body;
  }

  /** 지금 연결이 provider 인 AGENT 에 옛 생각의 깊이를 넣어 둔다(provider null = 연결 없음). */
  private long agentWith(String provider, String depth) {
    long agent = TestFixtures.createAgentNoToken(dsl);
    if (provider != null) credentialRepo.insert(agent, provider, "enc", "t", agent);
    configRepo.upsert(agent, "m", depth, null, null);
    return agent;
  }

  private String depthOf(long agent) {
    return configRepo.find(agent).orElseThrow().thinkingDepth();
  }

  @Test
  void V263_이관은_Claude_연결만_effort_로_옮기고_나머지는_DEFAULT_로_둔다() throws IOException {
    long claudeNone = agentWith("anthropic", "NONE");
    long claudeNormal = agentWith("anthropic", "NORMAL");
    long claudeDeep = agentWith("anthropic", "DEEP");
    long opencodeNormal = agentWith("opencode", "NORMAL");
    long noCredential = agentWith(null, "DEEP");
    long claudeUnset = agentWith("anthropic", null);
    long alreadyNew = agentWith("anthropic", "MEDIUM");
    // 예전 Claude 연결은 회수되고 지금은 opencode — 지금 연결 기준이라 DEFAULT.
    long switched = agentWith("anthropic", "DEEP");
    credentialRepo.revokeActive(switched);
    credentialRepo.insert(switched, "opencode", "enc", "t", switched);

    dsl.execute(migrateSql());

    assertThat(depthOf(claudeNone)).isEqualTo("LOW");
    assertThat(depthOf(claudeNormal)).isEqualTo("HIGH");
    assertThat(depthOf(claudeDeep)).isEqualTo("MAX");
    assertThat(depthOf(opencodeNormal)).isEqualTo("DEFAULT");
    assertThat(depthOf(noCredential)).isEqualTo("DEFAULT");
    assertThat(depthOf(switched)).isEqualTo("DEFAULT");
    assertThat(depthOf(claudeUnset)).isNull();
    assertThat(depthOf(alreadyNew)).isEqualTo("MEDIUM");
  }
}
