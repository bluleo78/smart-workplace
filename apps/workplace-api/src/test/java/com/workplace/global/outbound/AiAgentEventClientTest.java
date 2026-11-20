package com.workplace.global.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.global.tenant.TenantContext;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** AiAgentEventClient 가 테넌트를 X-AI-Run 헤더로 싣는지 검증한다 (WP-1828). Spring 컨텍스트 없이 동작. */
class AiAgentEventClientTest {

  private static final EventEnvelope ENVELOPE = new EventEnvelope("t", Map.of());

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void 테넌트_맥락이_있으면_X_AI_Run_헤더에_tenantId_를_싣는다() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://agent");
    MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    AtomicReference<String> captured = new AtomicReference<>();
    server
        .expect(requestTo("http://agent/events"))
        .andExpect(
            request ->
                captured.set(request.getHeaders().getFirst(AiAgentEventClient.AI_RUN_HEADER)))
        .andRespond(withSuccess());
    TenantContext.set(7L);

    new AiAgentEventClient(builder, "tok", 1).publish(ENVELOPE);

    server.verify();
    assertThat(captured.get()).isNotNull().doesNotContain("=");
    String json = new String(Base64.getUrlDecoder().decode(captured.get()), StandardCharsets.UTF_8);
    assertThat(json).isEqualTo("{\"tenantId\":7}");
  }

  @Test
  void 테넌트_맥락이_없으면_헤더가_없다() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://agent");
    MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    server
        .expect(requestTo("http://agent/events"))
        .andExpect(headerDoesNotExist(AiAgentEventClient.AI_RUN_HEADER))
        .andExpect(header("Authorization", "Internal tok"))
        .andRespond(withSuccess());

    new AiAgentEventClient(builder, "tok", 1).publish(ENVELOPE);

    server.verify();
  }
}
