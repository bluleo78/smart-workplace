package com.workplace.home.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.home.exception.HomeComposeUnavailableException;
import com.workplace.home.outbound.ComposeMessages.ComposeRequest;
import com.workplace.home.outbound.ComposeMessages.ComposeResult;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class AiAgentComposeClientTest {

  private RestClient.Builder builder;
  private MockRestServiceServer server;
  private AiAgentComposeClient client;

  @BeforeEach
  void setUp() {
    builder = RestClient.builder().baseUrl("http://ai-agent.test");
    server = MockRestServiceServer.bindTo(builder).build();
    client = new AiAgentComposeClient(builder, "tok-123");
  }

  @Test
  void 정상_응답을_ComposeResult_로_역직렬화() {
    server
        .expect(requestTo("http://ai-agent.test/home/compose"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header(HttpHeaders.AUTHORIZATION, "Internal tok-123"))
        .andExpect(jsonPath("$.query").value("내 할 일"))
        .andExpect(jsonPath("$.assistantAgentId").value(5))
        .andExpect(jsonPath("$.model").value("claude-sonnet-4-6"))
        .andExpect(jsonPath("$.thinkingDepth").value("NORMAL"))
        .andRespond(
            withSuccess(
                "{\"message\":\"할 일이에요\",\"widgets\":[{\"type\":\"my_tasks\",\"params\":{}}]}",
                MediaType.APPLICATION_JSON));

    ComposeResult res =
        client.compose(
            new ComposeRequest("내 할 일", List.of(), 5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));

    assertThat(res.message()).isEqualTo("할 일이에요");
    assertThat(res.widgets().get(0).get("type").asText()).isEqualTo("my_tasks");
    server.verify();
  }

  @Test
  void 서버오류_시_재시도없이_AiAgentComposeException() {
    server
        .expect(requestTo("http://ai-agent.test/home/compose"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withServerError());

    assertThatThrownBy(
            () ->
                client.compose(
                    new ComposeRequest(
                        "x", List.of(), 5L, "claude-sonnet-4-6", "NORMAL", 8, 60000)))
        .isInstanceOf(AiAgentComposeException.class);
    server.verify(); // 단 1회 호출(무재시도) 검증
  }

  @Test
  void 홈컴포저_미설정_503_은_HomeComposeUnavailableException_명확메시지로_변환() {
    // #50 — ai-agent 가 503 home_composer_not_configured 를 주면 제네릭 502 가 아니라
    // 사용자에게 명확한 사유 메시지를 주는 503(HomeComposeUnavailableException)으로 변환되어야 한다.
    server
        .expect(requestTo("http://ai-agent.test/home/compose"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(
            withStatus(HttpStatus.SERVICE_UNAVAILABLE)
                .body("{\"error\":\"home_composer_not_configured\"}")
                .contentType(MediaType.APPLICATION_JSON));

    assertThatThrownBy(
            () ->
                client.compose(
                    new ComposeRequest(
                        "안녕", List.of(), 5L, "claude-sonnet-4-6", "NORMAL", 8, 60000)))
        .isInstanceOf(HomeComposeUnavailableException.class)
        .hasMessageContaining("설정되지 않");
    server.verify();
  }
}
