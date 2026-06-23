package com.workplace.messaging.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

import com.workplace.messaging.outbound.dto.CatchupSummarizeRequest;
import com.workplace.messaging.outbound.dto.CatchupSummarizeResult;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** 캐치업 AI 클라이언트 테스트 — /messaging/catchup 엔드포인트 호출 및 응답 파싱. */
class AiAgentCatchupClientTest {
  private RestClient.Builder builder;
  private MockRestServiceServer server;
  private AiAgentCatchupClient client;

  @BeforeEach
  void setUp() {
    builder = RestClient.builder().baseUrl("http://ai-agent.test");
    server = MockRestServiceServer.bindTo(builder).build();
    client = new AiAgentCatchupClient(builder, "tok-456");
  }

  @Test
  void summarize_200_응답_파싱() {
    // given: /messaging/catchup 로 POST 요청 기대. Internal 토큰 헤더 + JSON 바디.
    server
        .expect(requestTo("http://ai-agent.test/messaging/catchup"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header(HttpHeaders.AUTHORIZATION, "Internal tok-456"))
        .andExpect(jsonPath("$.messages[0].id").value(10))
        .andRespond(
            withSuccess(
                "{\"decisions\":[{\"text\":\"출시 6/30\",\"sourceMessageIds\":[10]}],"
                    + "\"discussion\":[]}",
                MediaType.APPLICATION_JSON));

    // when: summarize 호출
    CatchupSummarizeResult res =
        client.summarize(
            new CatchupSummarizeRequest(
                List.of(new CatchupSummarizeRequest.Msg(10, "양동희", "출시 6/30 어때요")),
                2L,
                "claude-sonnet-4-6",
                3,
                60_000L));

    // then: 결정 항목 + sourceMessageIds 정확 파싱
    assertThat(res.decisions()).hasSize(1);
    assertThat(res.decisions().get(0).sourceMessageIds()).containsExactly(10L);
    assertThat(res.discussion()).isEmpty();
  }
}
