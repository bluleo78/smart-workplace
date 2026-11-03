package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.Test;

/**
 * WP-1296·1297 로그인 정보 다듬기 단위 테스트 — ChatGPT(Codex)·Gen:iA auth.json 을 받아 필요한 키만 남기고, 형식이 틀리면 입력 값을
 * 싣지 않은 한국어 문구로 거절한다. 모든 값은 가짜다.
 */
class LoginInfoNormalizerTest {

  private static final ObjectMapper OM = new ObjectMapper();
  private static final String SECRET_MARK = "fake-refresh-SECRETVALUE";

  /** 가짜 id_token — 본문에 email 만 둔 서명 없는 JWT 모양. */
  static String fakeIdToken(String email) {
    Base64.Encoder enc = Base64.getUrlEncoder().withoutPadding();
    String header = enc.encodeToString("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8));
    String body =
        enc.encodeToString(("{\"email\":\"" + email + "\"}").getBytes(StandardCharsets.UTF_8));
    return header + "." + body + ".sig";
  }

  /** Codex 가 남기는 auth.json 모양(가짜 값, 남는 키 포함). */
  static String chatgptAuthJson(String email) {
    return "{\"auth_mode\":\"chatgpt\",\"OPENAI_API_KEY\":\"sk-fake\",\"extra\":1,"
        + "\"tokens\":{\"id_token\":\""
        + fakeIdToken(email)
        + "\",\"access_token\":\"fake-access\",\"refresh_token\":\""
        + SECRET_MARK
        + "\",\"account_id\":\"acc-1\",\"other\":\"x\"},"
        + "\"last_refresh\":\"2026-11-01T00:00:00Z\"}";
  }

  /** Gen:iA Code 가 남기는 auth.json 모양(가짜 값, 다른 계정 키 포함). */
  static String geniaAuthJson(String email) {
    return "{\"genia\":{\"type\":\"oauth\",\"refresh\":\""
        + SECRET_MARK
        + "\",\"access\":\"fake-access\",\"email\":\""
        + email
        + "\"},\"anthropic\":{\"type\":\"api\",\"key\":\"fake\"}}";
  }

  /** ChatGPT — 정해진 키만 남기고 OPENAI_API_KEY 는 null, 앞뒤 공백은 지운다. */
  @Test
  void normalize_chatgpt_keepsOnlyKnownKeys() throws Exception {
    String out =
        LoginInfoNormalizer.normalize(
            AgentProviders.CHATGPT, "  \n" + chatgptAuthJson("a@example.test") + "\n ");

    JsonNode n = OM.readTree(out);
    assertThat(n.get("auth_mode").asText()).isEqualTo("chatgpt");
    assertThat(n.get("OPENAI_API_KEY").isNull()).isTrue();
    assertThat(n.has("extra")).isFalse();
    assertThat(n.get("tokens").properties().stream().map(e -> e.getKey()).toList())
        .containsExactly("id_token", "access_token", "refresh_token", "account_id");
    assertThat(n.get("last_refresh").asText()).isEqualTo("2026-11-01T00:00:00Z");
  }

  /** ChatGPT — tokens 에 없는 키·last_refresh 는 싣지 않는다. */
  @Test
  void normalize_chatgpt_omitsAbsentKeys() throws Exception {
    String out =
        LoginInfoNormalizer.normalize(
            AgentProviders.CHATGPT,
            "{\"auth_mode\":\"chatgpt\",\"tokens\":{\"refresh_token\":\"r\"}}");

    JsonNode n = OM.readTree(out);
    assertThat(n.get("tokens").size()).isEqualTo(1);
    assertThat(n.has("last_refresh")).isFalse();
  }

  /** ChatGPT — API 키 로그인·갱신 토큰 없음·Gen:iA 정보는 각자 문구로 거절하고 값을 싣지 않는다. */
  @Test
  void normalize_chatgpt_whenWrongShape_rejectsWithoutEchoingValues() {
    assertRejects(
        AgentProviders.CHATGPT,
        "{\"auth_mode\":\"apikey\",\"OPENAI_API_KEY\":\"" + SECRET_MARK + "\"}",
        LoginInfoNormalizer.NOT_CHATGPT);
    assertRejects(
        AgentProviders.CHATGPT,
        "{\"auth_mode\":\"chatgpt\",\"tokens\":{\"access_token\":\"" + SECRET_MARK + "\"}}",
        LoginInfoNormalizer.NO_REFRESH);
    assertRejects(
        AgentProviders.CHATGPT,
        "{\"auth_mode\":\"chatgpt\",\"tokens\":{\"refresh_token\":\"  \"}}",
        LoginInfoNormalizer.NO_REFRESH);
    assertRejects(
        AgentProviders.CHATGPT, geniaAuthJson("a@example.test"), LoginInfoNormalizer.GENIA_GIVEN);
  }

  /**
   * ChatGPT — auth_mode 키가 없는 옛 Codex 파일도 API 키가 비었으면(null·없음·빈 문자열) 받고, auth_mode: chatgpt 를 채워
   * 다듬는다.
   */
  @Test
  void normalize_chatgpt_whenAuthModeMissingAndApiKeyEmpty_acceptsAndFillsAuthMode()
      throws Exception {
    String tokens = "\"tokens\":{\"refresh_token\":\"" + SECRET_MARK + "\"}";
    for (String raw :
        new String[] {
          "{\"OPENAI_API_KEY\":null," + tokens + ",\"last_refresh\":\"2026-11-01T00:00:00Z\"}",
          "{" + tokens + "}",
          "{\"OPENAI_API_KEY\":\"\"," + tokens + "}"
        }) {
      JsonNode n = OM.readTree(LoginInfoNormalizer.normalize(AgentProviders.CHATGPT, raw));
      assertThat(n.get("auth_mode").asText()).isEqualTo("chatgpt");
      assertThat(n.get("OPENAI_API_KEY").isNull()).isTrue();
      assertThat(n.at("/tokens/refresh_token").asText()).isEqualTo(SECRET_MARK);
    }
  }

  /** ChatGPT — auth_mode 가 없는데 API 키가 있으면 API 키 로그인으로 보고 거절한다. Gen:iA 로 넣으면 ChatGPT 정보라고 알린다. */
  @Test
  void normalize_whenAuthModeMissingButApiKeyPresent_rejects() {
    String raw =
        "{\"OPENAI_API_KEY\":\"" + SECRET_MARK + "\",\"tokens\":{\"refresh_token\":\"r\"}}";
    assertRejects(AgentProviders.CHATGPT, raw, LoginInfoNormalizer.NOT_CHATGPT);
    assertRejects(
        AgentProviders.GENIA,
        "{\"OPENAI_API_KEY\":null,\"tokens\":{\"refresh_token\":\"r\"}}",
        LoginInfoNormalizer.CHATGPT_GIVEN);
  }

  /**
   * 판정 순서는 웹과 같다 — 내 모양이 아니면 상대 모양일 때 「~정보예요」, 아니면 「~가 아니에요」. genia·tokens 가 함께 든 섞인 파일은 고른 쪽 모양으로
   * 읽는다(ChatGPT 면 Codex 로, Gen:iA 면 Gen:iA 로).
   */
  @Test
  void normalize_whenMixedOrOtherShape_followsWebOrder() throws Exception {
    String mixed =
        "{\"genia\":{\"type\":\"oauth\",\"refresh\":\"g\"},"
            + "\"auth_mode\":\"chatgpt\",\"tokens\":{\"refresh_token\":\"c\"}}";
    assertThat(
            OM.readTree(LoginInfoNormalizer.normalize(AgentProviders.CHATGPT, mixed))
                .at("/tokens/refresh_token")
                .asText())
        .isEqualTo("c");
    assertThat(
            OM.readTree(LoginInfoNormalizer.normalize(AgentProviders.GENIA, mixed))
                .at("/genia/refresh")
                .asText())
        .isEqualTo("g");
    // tokens 없는 chatgpt 표시만 있는 파일은 Codex 모양이 아니다.
    assertRejects(
        AgentProviders.CHATGPT, "{\"auth_mode\":\"chatgpt\"}", LoginInfoNormalizer.NOT_CHATGPT);
  }

  /** Gen:iA — genia 객체만 그대로 남기고 다른 최상위 키는 버린다. */
  @Test
  void normalize_genia_keepsOnlyGeniaObject() throws Exception {
    String out =
        LoginInfoNormalizer.normalize(AgentProviders.GENIA, " " + geniaAuthJson("g@example.test"));

    JsonNode n = OM.readTree(out);
    assertThat(n.properties().stream().map(e -> e.getKey()).toList()).containsExactly("genia");
    assertThat(n.at("/genia/refresh").asText()).isEqualTo(SECRET_MARK);
    assertThat(n.at("/genia/access").asText()).isEqualTo("fake-access");
  }

  /** Gen:iA — oauth 가 아니거나 refresh 가 없거나 ChatGPT 정보면 거절한다. */
  @Test
  void normalize_genia_whenWrongShape_rejectsWithoutEchoingValues() {
    assertRejects(
        AgentProviders.GENIA,
        "{\"genia\":{\"type\":\"api\",\"key\":\"" + SECRET_MARK + "\"}}",
        LoginInfoNormalizer.NOT_GENIA);
    assertRejects(
        AgentProviders.GENIA,
        "{\"genia\":{\"type\":\"oauth\",\"access\":\"" + SECRET_MARK + "\"}}",
        LoginInfoNormalizer.NOT_GENIA);
    assertRejects(
        AgentProviders.GENIA, "{\"other\":\"" + SECRET_MARK + "\"}", LoginInfoNormalizer.NOT_GENIA);
    assertRejects(
        AgentProviders.GENIA, chatgptAuthJson("a@example.test"), LoginInfoNormalizer.CHATGPT_GIVEN);
  }

  /** 읽지 못하는 글·객체가 아닌 JSON 은 같은 문구, 빈 값은 「넣어 주세요」. 파싱 오류 문구(입력 인용)를 싣지 않는다. */
  @Test
  void normalize_whenUnreadable_rejects() {
    for (String provider : new String[] {AgentProviders.CHATGPT, AgentProviders.GENIA}) {
      assertRejects(provider, "{\"genia\": " + SECRET_MARK, LoginInfoNormalizer.UNREADABLE);
      assertRejects(provider, "[\"" + SECRET_MARK + "\"]", LoginInfoNormalizer.UNREADABLE);
      assertRejects(provider, "\"" + SECRET_MARK + "\"", LoginInfoNormalizer.UNREADABLE);
      assertRejects(provider, "   ", LoginInfoNormalizer.EMPTY);
      assertRejects(provider, null, LoginInfoNormalizer.EMPTY);
    }
  }

  /** 계정 이메일 — chatgpt 는 id_token 본문의 email, genia 는 genia.email, 읽지 못하면 null. */
  @Test
  void accountEmail_readsEmailBestEffort() {
    String chatgpt =
        LoginInfoNormalizer.normalize(AgentProviders.CHATGPT, chatgptAuthJson("c@example.test"));
    String genia =
        LoginInfoNormalizer.normalize(AgentProviders.GENIA, geniaAuthJson("g@example.test"));

    assertThat(LoginInfoNormalizer.accountEmail(AgentProviders.CHATGPT, chatgpt))
        .isEqualTo("c@example.test");
    assertThat(LoginInfoNormalizer.accountEmail(AgentProviders.GENIA, genia))
        .isEqualTo("g@example.test");
    assertThat(
            LoginInfoNormalizer.accountEmail(
                AgentProviders.CHATGPT,
                "{\"tokens\":{\"id_token\":\"not-a-jwt\",\"refresh_token\":\"r\"}}"))
        .isNull();
    assertThat(LoginInfoNormalizer.accountEmail(AgentProviders.GENIA, "broken")).isNull();
  }

  private static void assertRejects(String provider, String raw, String message) {
    assertThatThrownBy(() -> LoginInfoNormalizer.normalize(provider, raw))
        .isInstanceOf(InvalidProviderCredentialException.class)
        .hasMessage(message)
        .hasNoCause();
  }
}
