package com.workplace.agentaccount.usage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.math.BigDecimal;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** ChatGPT wham 사용량 조회기 — auth.json 해석·응답 변환·실패 코드. */
class ChatgptUsageProbeTest {

  private static final String AUTH =
      "{\"auth_mode\":\"chatgpt\",\"tokens\":{\"id_token\":\"idt\",\"access_token\":\"at-secret-1\","
          + "\"refresh_token\":\"rt\",\"account_id\":\"acct-9\"}}";
  private static final String URL = "https://chatgpt.test/backend-api/wham/usage";

  private MockRestServiceServer server;
  private ChatgptUsageProbe probe;

  @BeforeEach
  void setUp() {
    RestClient.Builder builder = RestClient.builder().baseUrl("https://chatgpt.test");
    server = MockRestServiceServer.bindTo(builder).build();
    probe = new ChatgptUsageProbe(builder.build());
  }

  private static String wham(boolean limitReached) {
    return "{\"rate_limit\":{\"limit_reached\":"
        + limitReached
        + ",\"primary_window\":{\"used_percent\":12.5,\"reset_at\":1800000000},"
        + "\"secondary_window\":{\"used_percent\":40,\"reset_after_seconds\":3600}}}";
  }

  @Test
  void parsesWham() throws Exception {
    server
        .expect(requestTo(URL))
        .andExpect(method(HttpMethod.GET))
        .andExpect(header("Authorization", "Bearer at-secret-1"))
        .andExpect(header("ChatGPT-Account-Id", "acct-9"))
        .andRespond(withSuccess(wham(false), MediaType.APPLICATION_JSON));

    Instant before = Instant.now();
    UsageReading r = probe.read(AUTH);

    assertThat(r.limitReached()).isFalse();
    UsageSnapshot five = r.windows().get(0);
    assertThat(five.window()).isEqualTo(UsageWindow.FIVE_HOUR);
    assertThat(five.usedPercent()).isEqualByComparingTo(new BigDecimal("12.50"));
    assertThat(five.resetsAt()).isEqualTo(Instant.ofEpochSecond(1800000000L));
    UsageSnapshot week = r.windows().get(1);
    assertThat(week.window()).isEqualTo(UsageWindow.WEEKLY);
    assertThat(week.usedPercent()).isEqualByComparingTo(new BigDecimal("40.00"));
    assertThat(week.resetsAt()).isAfter(before.plusSeconds(3500));
    server.verify();
  }

  @Test
  void limitReachedTrue() throws Exception {
    server.expect(requestTo(URL)).andRespond(withSuccess(wham(true), MediaType.APPLICATION_JSON));

    assertThat(probe.read(AUTH).limitReached()).isTrue();
  }

  @Test
  void http401_tokenExpired() {
    server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.UNAUTHORIZED));

    assertThatThrownBy(() -> probe.read(AUTH))
        .isInstanceOfSatisfying(
            UsageProbeException.class,
            e -> {
              assertThat(e.code()).isEqualTo("TOKEN_EXPIRED");
              assertThat(e.userMessage()).contains("토큰 만료");
            });
  }

  @Test
  void brokenAuthJson_badSecret_noHttpCall() {
    assertThatThrownBy(() -> probe.read("not-json"))
        .isInstanceOfSatisfying(
            UsageProbeException.class, e -> assertThat(e.code()).isEqualTo("BAD_SECRET"));
    assertThatThrownBy(() -> probe.read("{\"tokens\":{\"access_token\":\"x\"}}"))
        .isInstanceOfSatisfying(
            UsageProbeException.class, e -> assertThat(e.code()).isEqualTo("BAD_SECRET"));
    server.verify(); // 기대가 없으므로 호출이 있었다면 위에서 이미 실패한다
  }

  @Test
  void noWindows_badResponse() {
    server
        .expect(requestTo(URL))
        .andRespond(withSuccess("{\"rate_limit\":{}}", MediaType.APPLICATION_JSON));

    assertThatThrownBy(() -> probe.read(AUTH))
        .isInstanceOfSatisfying(
            UsageProbeException.class, e -> assertThat(e.code()).isEqualTo("BAD_RESPONSE"));
  }

  @Test
  void exceptionMessageNeverContainsAccessToken() {
    server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.UNAUTHORIZED));

    assertThatThrownBy(() -> probe.read(AUTH))
        .isInstanceOfSatisfying(
            UsageProbeException.class,
            e -> {
              assertThat(e.getMessage()).doesNotContain("at-secret-1").doesNotContain("acct-9");
              assertThat(e.userMessage()).doesNotContain("at-secret-1");
            });
  }
}
