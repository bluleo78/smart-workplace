package com.workplace.home.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.home.exception.HomeContextSummaryException;
import com.workplace.home.outbound.ChatMessages.ContextMessage;
import com.workplace.home.outbound.ChatMessages.ContextSummaryRequest;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** AiAgentContextSummaryClient(WP-232) — ai-agent /home/context-summary 요청 계약과 실패 매핑. */
class AiAgentContextSummaryClientTest {

  private final RestClient.Builder builder = RestClient.builder().baseUrl("http://ai");
  private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
  private final AiAgentContextSummaryClient client =
      new AiAgentContextSummaryClient(builder, "tok");

  private static ContextSummaryRequest req() {
    return new ContextSummaryRequest(
        5L, "claude-sonnet-4-6", 3, 60_000, "이전 요약", List.of(new ContextMessage("USER", "질문1")));
  }

  @Test
  void 요청본문_필드명이_ai_agent_스키마와_일치하고_summary_를_반환() {
    server
        .expect(requestTo("http://ai/home/context-summary"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header("Authorization", "Internal tok"))
        .andExpect(jsonPath("$.assistantAgentId").value(5))
        .andExpect(jsonPath("$.model").value("claude-sonnet-4-6"))
        .andExpect(jsonPath("$.maxTurns").value(3))
        .andExpect(jsonPath("$.timeoutMs").value(60000))
        .andExpect(jsonPath("$.previousSummary").value("이전 요약"))
        .andExpect(jsonPath("$.messages[0].role").value("USER"))
        .andExpect(jsonPath("$.messages[0].content").value("질문1"))
        .andRespond(withSuccess("{\"summary\":\"갱신 요약\"}", MediaType.APPLICATION_JSON));

    assertThat(client.summarize(req()).summary()).isEqualTo("갱신 요약");
    server.verify();
  }

  @Test
  void 실패응답은_HomeContextSummaryException() {
    server.expect(requestTo("http://ai/home/context-summary")).andRespond(withServerError());
    assertThatThrownBy(() -> client.summarize(req()))
        .isInstanceOf(HomeContextSummaryException.class);
  }
}
