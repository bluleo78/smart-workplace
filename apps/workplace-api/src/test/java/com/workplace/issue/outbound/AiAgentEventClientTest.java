package com.workplace.issue.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.outbound.EventEnvelope;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.ExpectedCount;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** AiAgentEventClient — RestClient 발사·재시도·인증·에러 분기 검증. */
class AiAgentEventClientTest {

  private RestClient.Builder builder;
  private MockRestServiceServer server;
  private AiAgentEventClient client;

  @BeforeEach
  void setUp() {
    builder = RestClient.builder().baseUrl("http://ai-agent.test");
    server = MockRestServiceServer.bindTo(builder).build();
    // 테스트는 백오프 1ms 로 — production 1s/2s/4s
    client = new AiAgentEventClient(builder, "tok-123", 1L);
  }

  @Test
  void 정상_200_응답_1회_호출() {
    server
        .expect(ExpectedCount.once(), requestTo("http://ai-agent.test/events"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header(HttpHeaders.AUTHORIZATION, "Internal tok-123"))
        .andExpect(jsonPath("$.type").value("issue.created"))
        .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

    client.publish(new EventEnvelope("issue.created", Map.of("issueKey", "WP-1")));

    server.verify();
  }

  @Test
  void 첫_500_후_200_총_2회_호출() {
    server
        .expect(ExpectedCount.once(), requestTo("http://ai-agent.test/events"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withServerError());
    server
        .expect(ExpectedCount.once(), requestTo("http://ai-agent.test/events"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

    client.publish(new EventEnvelope("issue.assigned", Map.of()));

    server.verify();
  }

  @Test
  void 모두_500_총_4회_호출_후_조용히_종료() {
    server
        .expect(ExpectedCount.times(4), requestTo("http://ai-agent.test/events"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withServerError());

    // throw 하지 않음 — 도메인 영향 X
    client.publish(new EventEnvelope("issue.commented", Map.of()));

    server.verify();
  }

  @Test
  void 클라이언트_400_즉시_포기_1회_호출() {
    server
        .expect(ExpectedCount.once(), requestTo("http://ai-agent.test/events"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withStatus(HttpStatus.BAD_REQUEST));

    client.publish(new EventEnvelope("issue.status_changed", Map.of()));

    server.verify();
  }

  @Test
  void Body_가_envelope_JSON_형태() {
    server
        .expect(ExpectedCount.once(), requestTo("http://ai-agent.test/events"))
        .andExpect(jsonPath("$.type").value("issue.created"))
        .andExpect(jsonPath("$.payload.issueKey").value("WP-42"))
        .andExpect(jsonPath("$.payload.issueId").value(42))
        .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

    client.publish(new EventEnvelope("issue.created", Map.of("issueKey", "WP-42", "issueId", 42L)));

    server.verify();
  }

  @Test
  void enabled_false_옵션은_클라이언트_레벨_관심사_아님() {
    // 이 테스트는 의도적 placeholder — enabled 처리는 dispatcher 책임.
    // 클라이언트는 항상 publish 하면 발사한다.
    assertThat(client).isNotNull();
  }
}
