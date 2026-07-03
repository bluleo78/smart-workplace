package com.workplace.auth.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.auth.dto.ModelOption;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.exception.AssistantModelsProbeException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
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
    client = new AiAgentModelsClient(builder, "tok-123");
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
}
