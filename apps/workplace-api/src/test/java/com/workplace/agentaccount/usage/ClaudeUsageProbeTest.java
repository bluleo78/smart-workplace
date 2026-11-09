package com.workplace.agentaccount.usage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;

import java.math.BigDecimal;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.client.response.DefaultResponseCreator;
import org.springframework.web.client.RestClient;

/** Claude 사용량 조회기 — unified 헤더 변환·실패 코드. */
class ClaudeUsageProbeTest {

  private static final String P = "anthropic-ratelimit-unified-";
  private MockRestServiceServer server;
  private ClaudeUsageProbe probe;

  @BeforeEach
  void setUp() {
    RestClient.Builder builder = RestClient.builder().baseUrl("https://claude.test");
    server = MockRestServiceServer.bindTo(builder).build();
    probe =
        new ClaudeUsageProbe(
            builder.build(),
            new AgentAccountUsageProperties(true, null, null, null, null, null, null, null, null));
  }

  private DefaultResponseCreator resp(HttpStatus status) {
    return withStatus(status).contentType(MediaType.APPLICATION_JSON).body("{}");
  }

  @Test
  void parsesUnifiedHeaders() throws Exception {
    server
        .expect(requestTo("https://claude.test/v1/messages"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header("Authorization", "Bearer sk-ant-secret"))
        .andExpect(header("anthropic-beta", "oauth-2025-04-20"))
        .andExpect(header("anthropic-version", "2023-06-01"))
        .andExpect(jsonPath("$.model").value("claude-haiku-4-5"))
        .andExpect(jsonPath("$.max_tokens").value(1))
        .andRespond(
            resp(HttpStatus.OK)
                .header(P + "5h-utilization", "0.08")
                .header(P + "5h-reset", "1800000000")
                .header(P + "5h-status", "allowed")
                .header(P + "7d-utilization", "0.85")
                .header(P + "7d-reset", "1800500000")
                .header(P + "status", "allowed"));

    UsageReading r = probe.read("sk-ant-secret");

    assertThat(r.limitReached()).isFalse();
    assertThat(r.windows()).hasSize(2);
    UsageSnapshot five = r.windows().get(0);
    assertThat(five.window()).isEqualTo(UsageWindow.FIVE_HOUR);
    assertThat(five.usedPercent()).isEqualByComparingTo(new BigDecimal("8.00"));
    assertThat(five.resetsAt()).isEqualTo(Instant.ofEpochSecond(1800000000L));
    assertThat(five.limitStatus()).isEqualTo("allowed");
    UsageSnapshot week = r.windows().get(1);
    assertThat(week.usedPercent()).isEqualByComparingTo(new BigDecimal("85.00"));
    assertThat(week.resetsAt()).isEqualTo(Instant.ofEpochSecond(1800500000L));
    assertThat(week.limitStatus()).isEqualTo("allowed"); // -7d-status 없음 → -status
    server.verify();
  }

  @Test
  void http429WithHeaders_isLimitReached() throws Exception {
    server
        .expect(requestTo("https://claude.test/v1/messages"))
        .andRespond(
            resp(HttpStatus.TOO_MANY_REQUESTS)
                .header(P + "5h-utilization", "1.0")
                .header(P + "5h-reset", "1800000000")
                .header(P + "5h-status", "rejected"));

    UsageReading r = probe.read("t");

    assertThat(r.limitReached()).isTrue();
    assertThat(r.windows()).hasSize(1);
    assertThat(r.windows().get(0).usedPercent()).isEqualByComparingTo(new BigDecimal("100"));
  }

  @Test
  void missingWeeklyHeader_returnsOnlyFiveHour() throws Exception {
    server
        .expect(requestTo("https://claude.test/v1/messages"))
        .andRespond(
            resp(HttpStatus.OK)
                .header(P + "5h-utilization", "0.5")
                .header(P + "5h-reset", "1800000000"));

    UsageReading r = probe.read("t");

    assertThat(r.windows())
        .extracting(UsageSnapshot::window)
        .containsExactly(UsageWindow.FIVE_HOUR);
  }

  @Test
  void noHeaders_badResponse() {
    server.expect(requestTo("https://claude.test/v1/messages")).andRespond(resp(HttpStatus.OK));

    assertThatThrownBy(() -> probe.read("t"))
        .isInstanceOfSatisfying(
            UsageProbeException.class, e -> assertThat(e.code()).isEqualTo("BAD_RESPONSE"));
  }

  @Test
  void http401_unauthorized_messageHasNoToken() {
    server
        .expect(requestTo("https://claude.test/v1/messages"))
        .andRespond(resp(HttpStatus.UNAUTHORIZED));

    assertThatThrownBy(() -> probe.read("sk-ant-secret-xyz"))
        .isInstanceOfSatisfying(
            UsageProbeException.class,
            e -> {
              assertThat(e.code()).isEqualTo("UNAUTHORIZED");
              assertThat(e.userMessage()).isEqualTo("토큰이 거절됨");
              assertThat(e.getMessage()).doesNotContain("sk-ant-secret-xyz");
            });
  }

  @Test
  void http500_noHeaders_httpCode() {
    server
        .expect(requestTo("https://claude.test/v1/messages"))
        .andRespond(resp(HttpStatus.INTERNAL_SERVER_ERROR));

    assertThatThrownBy(() -> probe.read("t"))
        .isInstanceOfSatisfying(
            UsageProbeException.class, e -> assertThat(e.code()).isEqualTo("HTTP_500"));
  }
}
