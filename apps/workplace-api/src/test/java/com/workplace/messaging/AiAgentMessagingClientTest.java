package com.workplace.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.messaging.outbound.AiAgentMessagingClient;
import com.workplace.messaging.outbound.dto.MessagingClassifyRequest;
import com.workplace.messaging.outbound.dto.MessagingClassifyResult;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** AiAgentMessagingClient HTTP 통신 단위 테스트. DB 불필요(MockRestServiceServer). */
class AiAgentMessagingClientTest {

  private RestClient.Builder builder;
  private MockRestServiceServer server;
  private AiAgentMessagingClient client;

  @BeforeEach
  void setUp() {
    // AiAgentMailClientTest 와 동일한 MockRestServiceServer 패턴
    builder = RestClient.builder().baseUrl("http://ai-agent.test");
    server = MockRestServiceServer.bindTo(builder).build();
    client = new AiAgentMessagingClient(builder, "tok-456");
  }

  @Test
  void classify_200_파싱() {
    // POST /messaging/classify → {"relevant":[{"userId":1,"reason":"r"}]} 스텁
    server
        .expect(requestTo("http://ai-agent.test/messaging/classify"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header(HttpHeaders.AUTHORIZATION, "Internal tok-456"))
        // 요청 바디 필드명 검증 — Jackson 직렬화 오탈자 방어
        .andExpect(jsonPath("$.messages[0].authorName").value("김PM"))
        .andExpect(jsonPath("$.messages[0].body").value("동희가 배포했나?"))
        .andExpect(jsonPath("$.members[0].userId").value(1))
        .andExpect(jsonPath("$.members[0].displayName").value("양동희"))
        .andExpect(jsonPath("$.assistantAgentId").value(2))
        .andExpect(jsonPath("$.model").value("claude-haiku-4-5-20251001"))
        .andExpect(jsonPath("$.maxTurns").value(4))
        .andExpect(jsonPath("$.timeoutMs").value(30000))
        .andRespond(
            withSuccess(
                "{\"relevant\":[{\"userId\":1,\"reason\":\"r\"}]}", MediaType.APPLICATION_JSON));

    MessagingClassifyResult res =
        client.classify(
            new MessagingClassifyRequest(
                List.of(new MessagingClassifyRequest.Msg("김PM", "동희가 배포했나?")),
                List.of(new MessagingClassifyRequest.Member(1L, "양동희")),
                2L,
                "claude-haiku-4-5-20251001",
                4,
                30000L));

    assertThat(res.relevant()).hasSize(1);
    assertThat(res.relevant().get(0).userId()).isEqualTo(1L);
    assertThat(res.relevant().get(0).reason()).isEqualTo("r");
    server.verify();
  }
}
