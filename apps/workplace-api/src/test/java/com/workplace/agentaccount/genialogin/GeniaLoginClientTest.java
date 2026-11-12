package com.workplace.agentaccount.genialogin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.genialogin.GeniaLoginClient.GeniaLoginUnavailable;
import com.workplace.agentaccount.genialogin.GeniaLoginClient.LoginStart;
import com.workplace.agentaccount.genialogin.GeniaLoginClient.PollResult;
import java.net.ServerSocket;
import java.time.Instant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

/** GeniaLoginClient 단위 테스트(WP-1461) — 가짜 Gen:iA 서버로 요청 모양과 응답 분류를 검증한다. */
class GeniaLoginClientTest {

  private static final ObjectMapper MAPPER = new ObjectMapper();
  private static final String LOGIN = "/auth/login";
  private static final String TOKEN = "/auth/login/token";

  private FakeGeniaServer server;
  private GeniaLoginClient client;

  @BeforeEach
  void setUp() throws Exception {
    server = new FakeGeniaServer();
    client = new GeniaLoginClient(RestClient.create(), server.url(), "genia-works");
  }

  @AfterEach
  void tearDown() {
    server.close();
  }

  /** 닫힌 포트를 가리키는 클라이언트. */
  private GeniaLoginClient refusedClient() throws Exception {
    int port;
    try (ServerSocket s = new ServerSocket(0)) {
      port = s.getLocalPort();
    }
    return new GeniaLoginClient(RestClient.create(), "http://127.0.0.1:" + port, "genia-works");
  }

  @Test
  void start_sendsChallengeAndClient() throws Exception {
    server.enqueue(LOGIN, 200, "{\"authorize_url\":\"https://x/a\",\"state\":\"st\"}");
    client.start("abc");
    assertThat(server.requests).hasSize(1);
    var req = server.requests.get(0);
    assertThat(req.path()).isEqualTo(LOGIN);
    assertThat(req.contentType()).contains("application/json");
    JsonNode body = MAPPER.readTree(req.body());
    assertThat(body.get("code_challenge").asText()).isEqualTo("abc");
    assertThat(body.get("client").asText()).isEqualTo("genia-works");
    assertThat(body.size()).isEqualTo(2);
  }

  @Test
  void start_parsesAuthorizeUrlStateIntervalExpiry() throws Exception {
    server.enqueue(
        LOGIN,
        200,
        "{\"authorize_url\":\"https://x/a?s=1\",\"state\":\"st\",\"interval\":2,"
            + "\"expires_at\":\"2026-11-12T10:10:00Z\"}");
    LoginStart s = client.start("abc");
    assertThat(s.authorizeUrl()).isEqualTo("https://x/a?s=1");
    assertThat(s.state()).isEqualTo("st");
    assertThat(s.intervalSeconds()).isEqualTo(2);
    assertThat(s.expiresAt()).isEqualTo(Instant.parse("2026-11-12T10:10:00Z"));
    assertThat(s.toString()).doesNotContain("\"st\"").doesNotContain("=st");
  }

  @Test
  void start_missingIntervalAndExpiry_usesDefaults() throws Exception {
    server.enqueue(LOGIN, 200, "{\"authorize_url\":\"https://x/a\",\"state\":\"st\"}");
    Instant before = Instant.now();
    LoginStart s = client.start("abc");
    assertThat(s.intervalSeconds()).isEqualTo(2);
    assertThat(s.expiresAt()).isAfter(before.plusSeconds(9 * 60));
  }

  /** 인증 주소는 웹이 새 창으로 여는 값이라 http(s) 절대 주소만 받는다 — javascript: 같은 주소는 시작 실패로 막는다. */
  @Test
  void start_nonHttpAuthorizeUrl_throwsUnavailable() {
    server.enqueue(LOGIN, 200, "{\"authorize_url\":\"javascript:alert(1)\",\"state\":\"st\"}");
    assertThatThrownBy(() -> client.start("abc"))
        .isInstanceOf(GeniaLoginUnavailable.class)
        .satisfies(e -> assertThat(((GeniaLoginUnavailable) e).code()).isEqualTo("bad_response"));
  }

  /** 상대 주소도 열 수 없으므로 시작 실패다. */
  @Test
  void start_relativeAuthorizeUrl_throwsUnavailable() {
    server.enqueue(LOGIN, 200, "{\"authorize_url\":\"/authorize?x=1\",\"state\":\"st\"}");
    assertThatThrownBy(() -> client.start("abc")).isInstanceOf(GeniaLoginUnavailable.class);
  }

  @Test
  void start_serverError_throwsUnavailable() {
    server.enqueue(LOGIN, 503, "{\"secret\":\"zzz\"}");
    assertThatThrownBy(() -> client.start("abc"))
        .isInstanceOf(GeniaLoginUnavailable.class)
        .satisfies(
            e -> {
              assertThat(e.getMessage()).doesNotContain(server.url()).doesNotContain("zzz");
            });
  }

  @Test
  void start_connectionRefused_throwsUnavailable() throws Exception {
    GeniaLoginClient c = refusedClient();
    assertThatThrownBy(() -> c.start("abc")).isInstanceOf(GeniaLoginUnavailable.class);
  }

  @Test
  void poll_sendsStateAndVerifier() throws Exception {
    server.enqueue(TOKEN, 400, "{\"error\":{\"type\":\"authorization_pending\"}}");
    client.poll("st1", "ver1");
    var req = server.requests.get(0);
    assertThat(req.path()).isEqualTo(TOKEN);
    JsonNode body = MAPPER.readTree(req.body());
    assertThat(body.get("state").asText()).isEqualTo("st1");
    assertThat(body.get("code_verifier").asText()).isEqualTo("ver1");
  }

  @Test
  void poll_authorizationPending_isPending() {
    server.enqueue(TOKEN, 400, "{\"error\":{\"type\":\"authorization_pending\"}}");
    assertThat(client.poll("s", "v")).isInstanceOf(PollResult.Pending.class);
  }

  @Test
  void poll_slowDown_isSlowDown() {
    server.enqueue(TOKEN, 400, "{\"error\":{\"type\":\"slow_down\"}}");
    assertThat(client.poll("s", "v")).isInstanceOf(PollResult.SlowDown.class);
  }

  @Test
  void poll_expiredToken_isExpired() {
    server.enqueue(TOKEN, 400, "{\"error\":{\"type\":\"expired_token\"}}");
    assertThat(client.poll("s", "v")).isInstanceOf(PollResult.Expired.class);
  }

  @Test
  void poll_stringError_isRead() {
    server.enqueue(TOKEN, 400, "{\"error\":\"authorization_pending\"}");
    assertThat(client.poll("s", "v")).isInstanceOf(PollResult.Pending.class);
  }

  @Test
  void poll_authenticationError_isFailedWithCode() {
    server.enqueue(TOKEN, 401, "{\"error\":{\"type\":\"authentication_error\"}}");
    assertThat(client.poll("s", "v")).isEqualTo(new PollResult.Failed("authentication_error"));
  }

  @Test
  void poll_unsafeErrorType_isFailedWithHttpStatus() {
    server.enqueue(TOKEN, 400, "{\"error\":{\"type\":\"Bearer abc.def\"}}");
    assertThat(client.poll("s", "v")).isEqualTo(new PollResult.Failed("http_400"));
  }

  @Test
  void poll_serverError_isUnavailable() {
    server.enqueue(TOKEN, 500, "{}");
    assertThat(client.poll("s", "v")).isInstanceOf(PollResult.Unavailable.class);
  }

  /** 429 는 slow_down 이 아니어도 일시 제한이라 Unavailable — 진행은 PENDING 으로 남아 다음 간격에 다시 묻는다. */
  @Test
  void poll_rateLimited_isUnavailable() {
    // Apache HttpClient 5 기본 재시도 전략이 429 를 한 번 다시 보내므로 두 번 쌓는다.
    server.enqueue(TOKEN, 429, "{\"error\":\"too_many_requests\"}");
    server.enqueue(TOKEN, 429, "{\"error\":\"too_many_requests\"}");
    assertThat(client.poll("s", "v")).isEqualTo(new PollResult.Unavailable("http_429"));
  }

  @Test
  void poll_connectionRefused_isUnavailable() throws Exception {
    assertThat(refusedClient().poll("s", "v")).isInstanceOf(PollResult.Unavailable.class);
  }

  @Test
  void poll_success_parsesTokenAndUser() {
    server.enqueue(
        TOKEN,
        200,
        "{\"access_token\":\"tok\",\"token_type\":\"Bearer\",\"expires_at\":1765000000,"
            + "\"user\":{\"email\":\"me@iacloud.kr\",\"id\":\"u1\",\"name\":\"나\","
            + "\"role\":\"member\"}}");
    PollResult r = client.poll("s", "v");
    assertThat(r)
        .isEqualTo(
            new PollResult.Success(
                "tok", Instant.ofEpochSecond(1765000000), "me@iacloud.kr", "member"));
    assertThat(r.toString()).doesNotContain("tok");
  }

  /** expires_at 이 없어도 성공이다 — 만료 시각은 서비스가 기본 수명으로 채운다. */
  @Test
  void poll_successWithoutExpiry_isSuccessWithNullExpiry() {
    server.enqueue(TOKEN, 200, "{\"access_token\":\"tok\",\"user\":{\"email\":\"me@iacloud.kr\"}}");
    assertThat(client.poll("s", "v"))
        .isEqualTo(new PollResult.Success("tok", null, "me@iacloud.kr", null));
  }

  @Test
  void poll_successWithoutAccessToken_isFailedBadResponse() {
    server.enqueue(TOKEN, 200, "{\"user\":{}}");
    assertThat(client.poll("s", "v")).isEqualTo(new PollResult.Failed("bad_response"));
  }

  @Test
  void parseInstant_acceptsSecondsMillisAndIso() throws Exception {
    assertThat(GeniaLoginClient.parseInstant(MAPPER.readTree("1765000000")))
        .isEqualTo(Instant.ofEpochSecond(1765000000));
    assertThat(GeniaLoginClient.parseInstant(MAPPER.readTree("1765000000000")))
        .isEqualTo(Instant.ofEpochSecond(1765000000));
    assertThat(GeniaLoginClient.parseInstant(MAPPER.readTree("\"2026-11-12T10:10:00Z\"")))
        .isEqualTo(Instant.parse("2026-11-12T10:10:00Z"));
    assertThat(GeniaLoginClient.parseInstant(MAPPER.readTree("\"garbage\""))).isNull();
    assertThat(GeniaLoginClient.parseInstant(null)).isNull();
    assertThat(GeniaLoginClient.parseInstant(MAPPER.readTree("{}").path("x"))).isNull();
  }
}
