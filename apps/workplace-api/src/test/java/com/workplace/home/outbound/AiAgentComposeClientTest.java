package com.workplace.home.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.home.outbound.ComposeMessages.ComposeRequest;
import com.workplace.home.outbound.ComposeMessages.ComposeResult;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
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
        .andRespond(
            withSuccess(
                "{\"message\":\"할 일이에요\",\"widgets\":[{\"type\":\"my_tasks\",\"params\":{}}]}",
                MediaType.APPLICATION_JSON));

    ComposeResult res = client.compose(new ComposeRequest("내 할 일", List.of()));

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

    assertThatThrownBy(() -> client.compose(new ComposeRequest("x", List.of())))
        .isInstanceOf(AiAgentComposeException.class);
    server.verify(); // 단 1회 호출(무재시도) 검증
  }
}
