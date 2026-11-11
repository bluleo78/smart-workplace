package com.workplace.auth.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withBadRequest;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.auth.dto.ModelOption;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.exception.AssistantModelsProbeException;
import com.workplace.auth.outbound.AiAgentModelsClient.CredentialCheck;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** AiAgentMailClient/AiAgentIssueClient 미러 — POST /models/list 동기 위임. */
class AiAgentModelsClientTest {

  private RestClient.Builder builder;
  private MockRestServiceServer server;
  private AiAgentModelsClient client;

  @BeforeEach
  void setUp() {
    builder = RestClient.builder().baseUrl("http://ai-agent.test");
    server = MockRestServiceServer.bindTo(builder).build();
    // 목록 조회·등록 확인이 같은 목 서버를 쓰도록 같은 빌더를 두 번 넘긴다(WP-1496 — 운영은 확인용 짧은 타임아웃 빌더가 따로다).
    client = new AiAgentModelsClient(builder, builder, "tok-123");
  }

  private ProviderConfig config() {
    return new ProviderConfig(
        "bedrock", null, Map.of("baseURL", "https://provider.test/v1", "apiKey", "sk-abc"));
  }

  @Test
  void 프로브_정상_모델목록_반환() {
    server
        .expect(requestTo("http://ai-agent.test/models/list"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header(HttpHeaders.AUTHORIZATION, "Internal tok-123"))
        .andExpect(jsonPath("$.options.baseURL").value("https://provider.test/v1"))
        .andExpect(jsonPath("$.options.apiKey").value("sk-abc"))
        // WP-1322: 등록 전 프로브는 생각의 깊이 단계를 묻지 않는다.
        .andExpect(jsonPath("$.withEfforts").value(false))
        .andRespond(
            withSuccess(
                "{\"models\":[{\"id\":\"openai.gpt-oss-120b-1:0\"}]}", MediaType.APPLICATION_JSON));

    List<ModelOption> result = client.probeModels(config());
    assertThat(result)
        .containsExactly(new ModelOption("openai.gpt-oss-120b-1:0", "openai.gpt-oss-120b-1:0"));
    server.verify();
  }

  @Test
  void 서버오류_AssistantModelsProbeException() {
    server.expect(requestTo("http://ai-agent.test/models/list")).andRespond(withServerError());
    assertThatThrownBy(() -> client.probeModels(config()))
        .isInstanceOf(AssistantModelsProbeException.class);
    server.verify();
  }

  @Test
  void apiKey_는_예외메시지에_노출되지_않는다() {
    server.expect(requestTo("http://ai-agent.test/models/list")).andRespond(withServerError());
    assertThatThrownBy(() -> client.probeModels(config()))
        .isInstanceOf(AssistantModelsProbeException.class)
        .satisfies(e -> assertThat(e.getMessage()).doesNotContain("sk-abc"));
    server.verify();
  }

  @Test // #873: anthropic 실시간 조회 — { token } 전달, display_name 라벨·최신순 유지
  void anthropic_모델목록_정상_라벨포함_순서유지() {
    server
        .expect(requestTo("http://ai-agent.test/models/anthropic/list"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header(HttpHeaders.AUTHORIZATION, "Internal tok-123"))
        .andExpect(jsonPath("$.token").value("sk-ant-oat01-x"))
        // WP-1496: 워크스페이스 ID 가 없으면 본문에 싣지 않는다(ai-agent 는 선택 필드로 받는다).
        .andExpect(jsonPath("$.workspaceId").doesNotExist())
        // WP-1496: 목록 조회는 probe 를 싣지 않는다(전체 목록을 받는다).
        .andExpect(jsonPath("$.probe").doesNotExist())
        .andRespond(
            withSuccess(
                "{\"models\":[{\"id\":\"claude-sonnet-5-5\",\"label\":\"Claude Sonnet 5.5\"},"
                    + "{\"id\":\"claude-opus-5-5\",\"label\":\"Claude Opus 5.5\"}]}",
                MediaType.APPLICATION_JSON));

    assertThat(client.listAnthropicModels("sk-ant-oat01-x", null))
        .containsExactly(
            new ModelOption("claude-sonnet-5-5", "Claude Sonnet 5.5"),
            new ModelOption("claude-opus-5-5", "Claude Opus 5.5"));
    server.verify();
  }

  @Test // #873: 서버오류는 예외(호출부가 정적 목록 폴백), token 은 메시지에 비노출. 빈 목록 판정은 ai-agent(502) 소관
  void anthropic_서버오류_예외_토큰비노출() {
    server
        .expect(requestTo("http://ai-agent.test/models/anthropic/list"))
        .andRespond(withServerError());
    assertThatThrownBy(() -> client.listAnthropicModels("sk-ant-oat01-secret", null))
        .isInstanceOf(AssistantModelsProbeException.class)
        .satisfies(e -> assertThat(e.getMessage()).doesNotContain("sk-ant-oat01-secret"));
    server.verify();
  }

  @Test // WP-1322: 모델별 생각의 깊이 단계(efforts)를 그대로 옮기고, 없으면 null(알 수 없음). provider npm 을 함께 보낸다.
  void 프로브_efforts_전달_및_npm_요청() {
    server
        .expect(requestTo("http://ai-agent.test/models/list"))
        .andExpect(jsonPath("$.npm").value("@ai-sdk/openai-compatible"))
        .andExpect(jsonPath("$.withEfforts").value(true))
        .andRespond(
            withSuccess(
                "{\"models\":[{\"id\":\"gpt-5\",\"efforts\":[\"LOW\",\"MEDIUM\",\"HIGH\"]},"
                    + "{\"id\":\"qwen3\",\"efforts\":[]},{\"id\":\"x\"}]}",
                MediaType.APPLICATION_JSON));

    List<ModelOption> result =
        client.probeModels(
            new ProviderConfig(
                "bedrock",
                "@ai-sdk/openai-compatible",
                Map.of("baseURL", "https://provider.test/v1", "apiKey", "sk-abc")),
            true);
    assertThat(result)
        .containsExactly(
            new ModelOption("gpt-5", "gpt-5", List.of("LOW", "MEDIUM", "HIGH")),
            new ModelOption("qwen3", "qwen3", List.of()),
            new ModelOption("x", "x", null));
    server.verify();
  }

  @Test // WP-1496: 사용자 API 키 조회는 워크스페이스 ID 를 본문에 싣는다
  void anthropic_모델목록_워크스페이스ID_전달() {
    server
        .expect(requestTo("http://ai-agent.test/models/anthropic/list"))
        .andExpect(jsonPath("$.token").value("sk-ant-usr01-x"))
        .andExpect(jsonPath("$.workspaceId").value("wrkspc_1"))
        .andRespond(
            withSuccess("{\"models\":[{\"id\":\"claude-opus-5-5\"}]}", MediaType.APPLICATION_JSON));

    assertThat(client.listAnthropicModels("sk-ant-usr01-x", "wrkspc_1"))
        .containsExactly(new ModelOption("claude-opus-5-5", "claude-opus-5-5"));
    server.verify();
  }

  @Test // WP-1496: 등록 확인 — 200 이면 받아들임
  void 키확인_정상이면_ACCEPTED() {
    server
        .expect(requestTo("http://ai-agent.test/models/anthropic/list"))
        .andExpect(header(HttpHeaders.AUTHORIZATION, "Internal tok-123"))
        .andExpect(jsonPath("$.workspaceId").value("wrkspc_1"))
        // WP-1496: 등록 확인은 probe 로 한 쪽(1개)만 받게 한다.
        .andExpect(jsonPath("$.probe").value(true))
        .andRespond(withSuccess("{\"models\":[]}", MediaType.APPLICATION_JSON));
    assertThat(client.checkAnthropicCredential("sk-ant-usr01-x", "wrkspc_1"))
        .isEqualTo(CredentialCheck.ACCEPTED);
    server.verify();
  }

  @Test // WP-1496: ai-agent 가 400 credential_rejected 면 거절
  void 키확인_credential_rejected_이면_REJECTED() {
    server
        .expect(requestTo("http://ai-agent.test/models/anthropic/list"))
        .andRespond(
            withBadRequest()
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"credential_rejected\",\"message\":\"키가 맞지 않아요\"}"));
    assertThat(client.checkAnthropicCredential("sk-ant-usr01-x", "wrkspc_1"))
        .isEqualTo(CredentialCheck.REJECTED);
    server.verify();
  }

  @Test // WP-1496 개정: 워크스페이스 ID 가 필요한 키(not scoped to a workspace)는 따로 알린다
  void 키확인_workspace_required_이면_WORKSPACE_REQUIRED() {
    server
        .expect(requestTo("http://ai-agent.test/models/anthropic/list"))
        .andExpect(jsonPath("$.token").value("sk-ant-api03-x"))
        .andExpect(jsonPath("$.workspaceId").doesNotExist())
        .andRespond(
            withBadRequest()
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"workspace_required\",\"message\":\"워크스페이스 필요\"}"));
    assertThat(client.checkAnthropicCredential("sk-ant-api03-x", null))
        .isEqualTo(CredentialCheck.WORKSPACE_REQUIRED);
    server.verify();
  }

  @Test // WP-1496: 키에 맞지 않는 워크스페이스 ID(Anthropic 400 「must be a valid workspace ID」)는 따로 알린다
  void 키확인_workspace_invalid_이면_WORKSPACE_INVALID() {
    server
        .expect(requestTo("http://ai-agent.test/models/anthropic/list"))
        .andExpect(jsonPath("$.workspaceId").value("wrkspc_wrong"))
        .andExpect(jsonPath("$.probe").value(true))
        .andRespond(
            withBadRequest()
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"workspace_invalid\"}"));
    assertThat(client.checkAnthropicCredential("sk-ant-usr01-x", "wrkspc_wrong"))
        .isEqualTo(CredentialCheck.WORKSPACE_INVALID);
    server.verify();
  }

  @Test // WP-1496: 다른 400(본문 검증 실패 등)·502·연결 실패는 모름 — 등록을 막지 않는다
  void 키확인_그밖의_실패는_UNAVAILABLE() {
    server
        .expect(requestTo("http://ai-agent.test/models/anthropic/list"))
        .andRespond(
            withBadRequest()
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"invalid_request\"}"));
    assertThat(client.checkAnthropicCredential("sk-ant-usr01-x", "wrkspc_1"))
        .isEqualTo(CredentialCheck.UNAVAILABLE);
    server.verify();

    server.reset();
    server
        .expect(requestTo("http://ai-agent.test/models/anthropic/list"))
        .andRespond(withStatus(HttpStatus.BAD_GATEWAY));
    assertThat(client.checkAnthropicCredential("sk-ant-usr01-x", "wrkspc_1"))
        .isEqualTo(CredentialCheck.UNAVAILABLE);
    server.verify();

    server.reset();
    server
        .expect(requestTo("http://ai-agent.test/models/anthropic/list"))
        .andRespond(withBadRequest().body("not json"));
    assertThat(client.checkAnthropicCredential("sk-ant-usr01-x", "wrkspc_1"))
        .isEqualTo(CredentialCheck.UNAVAILABLE);
    server.verify();
  }
}
