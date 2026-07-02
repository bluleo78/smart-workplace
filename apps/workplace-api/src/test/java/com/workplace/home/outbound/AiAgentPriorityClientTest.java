package com.workplace.home.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.home.exception.PriorityAiException;
import com.workplace.home.outbound.dto.PriorityClassifyRequest;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** AiAgentPriorityClient — 성공/실패 응답 처리 검증(MockRestServiceServer). */
class AiAgentPriorityClientTest {

  private PriorityClassifyRequest sampleRequest() {
    return new PriorityClassifyRequest(
        List.of(new PriorityClassifyRequest.CandidateLine("ISSUE_DUE", "1", "이슈 A", "마감 오늘")),
        99L,
        "claude-sonnet-5",
        6,
        90_000L);
  }

  @Test
  void classify_성공_응답을_파싱한다() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://localhost:9999");
    MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    server
        .expect(requestTo("http://localhost:9999/home/priority-classify"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header("Authorization", "Internal test-token"))
        .andRespond(
            withSuccess(
                "{\"results\":[{\"sourceType\":\"ISSUE_DUE\",\"sourceId\":\"1\",\"importanceScore\":80,\"urgencyScore\":90,\"reason\":\"고객 마감\"}]}",
                MediaType.APPLICATION_JSON));

    AiAgentPriorityClient client = new AiAgentPriorityClient(builder, "test-token");
    var result = client.classify(sampleRequest());

    assertThat(result.results()).hasSize(1);
    assertThat(result.results().get(0).importanceScore()).isEqualTo(80);
    server.verify();
  }

  @Test
  void classify_5xx_응답이면_PriorityAiException을_던진다() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://localhost:9998");
    MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    server
        .expect(requestTo("http://localhost:9998/home/priority-classify"))
        .andRespond(withServerError());

    AiAgentPriorityClient client = new AiAgentPriorityClient(builder, "test-token");
    assertThatThrownBy(() -> client.classify(sampleRequest()))
        .isInstanceOf(PriorityAiException.class);
  }
}
