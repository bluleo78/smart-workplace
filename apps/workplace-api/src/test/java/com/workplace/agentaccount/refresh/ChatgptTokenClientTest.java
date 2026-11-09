package com.workplace.agentaccount.refresh;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.refresh.ChatgptTokenClient.ChatgptTokens;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

/** ChatGPT 토큰 갱신 클라이언트 — 요청 모양(Codex 와 같음)·응답 해석·실패 분류를 가짜 HTTP 서버로 확인한다. */
class ChatgptTokenClientTest {

  private static final ObjectMapper JSON = new ObjectMapper();

  private FakeTokenServer server;
  private ChatgptTokenClient client;

  @BeforeEach
  void setUp() throws Exception {
    server = new FakeTokenServer();
    client = new ChatgptTokenClient(RestClient.create(), server.url());
  }

  @AfterEach
  void tearDown() {
    server.close();
  }

  @Test
  void sendsExactRequestBody() throws Exception {
    server.responseBody = "{\"access_token\":\"a\"}";

    client.refresh("rt-old");

    assertThat(server.requests).hasSize(1);
    var req = server.requests.get(0);
    assertThat(req.contentType()).startsWith("application/json");
    JsonNode body = JSON.readTree(req.body());
    assertThat(body.size()).isEqualTo(3);
    assertThat(body.get("client_id").asText()).isEqualTo("app_EMoamEEZ73f0CkXaXp7hrann");
    assertThat(body.get("grant_type").asText()).isEqualTo("refresh_token");
    assertThat(body.get("refresh_token").asText()).isEqualTo("rt-old");
  }

  @Test
  void parsesAllThreeTokens() throws Exception {
    server.responseBody =
        "{\"access_token\":\"at-new\",\"refresh_token\":\"rt-new\",\"id_token\":\"id-new\"}";

    ChatgptTokens t = client.refresh("rt-old");

    assertThat(t.accessToken()).isEqualTo("at-new");
    assertThat(t.refreshToken()).isEqualTo("rt-new");
    assertThat(t.idToken()).isEqualTo("id-new");
  }

  @Test
  void missingRefreshToken_isNull() throws Exception {
    server.responseBody = "{\"access_token\":\"at-new\",\"id_token\":\"id-new\"}";

    ChatgptTokens t = client.refresh("rt-old");

    assertThat(t.refreshToken()).isNull();
    assertThat(t.accessToken()).isEqualTo("at-new");
  }

  @Test
  void unauthorized_isPermanent() {
    server.status = 401;
    server.responseBody = "{}";

    assertThatThrownBy(() -> client.refresh("rt-old"))
        .isInstanceOfSatisfying(
            ChatgptTokenRefreshException.class, e -> assertThat(e.permanent()).isTrue());
  }

  @Test
  void invalidGrant_isPermanent() {
    server.status = 400;
    server.responseBody = "{\"error\":\"invalid_grant\"}";

    assertThatThrownBy(() -> client.refresh("rt-old"))
        .isInstanceOfSatisfying(
            ChatgptTokenRefreshException.class,
            e -> {
              assertThat(e.permanent()).isTrue();
              assertThat(e.code()).isEqualTo("invalid_grant");
            });
  }

  @Test
  void refreshTokenReused_isPermanentWithCode() {
    server.status = 400;
    server.responseBody = "{\"error\":{\"code\":\"refresh_token_reused\"}}";

    assertThatThrownBy(() -> client.refresh("rt-old"))
        .isInstanceOfSatisfying(
            ChatgptTokenRefreshException.class,
            e -> {
              assertThat(e.permanent()).isTrue();
              assertThat(e.code()).isEqualTo("refresh_token_reused");
            });
  }

  @Test
  void serverError_isTransient() {
    server.status = 500;
    server.responseBody = "{\"error\":\"boom rt-old\"}";

    assertThatThrownBy(() -> client.refresh("rt-old"))
        .isInstanceOfSatisfying(
            ChatgptTokenRefreshException.class,
            e -> {
              assertThat(e.permanent()).isFalse();
              assertThat(e.getMessage()).doesNotContain("rt-old");
            });
  }

  @Test
  void connectionFailure_isTransient() {
    // 닫힌 포트 — 연결 거절.
    server.close();

    assertThatThrownBy(() -> client.refresh("rt-old"))
        .isInstanceOfSatisfying(
            ChatgptTokenRefreshException.class, e -> assertThat(e.permanent()).isFalse());
  }

  @Test
  void okWithoutAccessToken_isTransientBadResponse() {
    server.responseBody = "{\"id_token\":\"x\"}";

    assertThatThrownBy(() -> client.refresh("rt-old"))
        .isInstanceOfSatisfying(
            ChatgptTokenRefreshException.class,
            e -> {
              assertThat(e.permanent()).isFalse();
              assertThat(e.code()).isEqualTo("bad_response");
            });
  }
}
