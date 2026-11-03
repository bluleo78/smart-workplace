package com.workplace.auth.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

/**
 * 「로그인 정보」(Gen:iA Code·Codex 의 auth.json) 검증·다듬기(WP-1296·1297). 붙여 넣은 파일 내용을 그 프로그램이 읽는 데 필요한 키만 남긴
 * JSON 으로 바꾼다 — 서버는 이 결과를 암호화해 저장하고 Pod 안에서만 파일이 된다.
 *
 * <p>예외 문구에는 입력 값을 절대 싣지 않는다(Jackson 파싱 오류 문구도 입력 조각을 인용하므로 버린다).
 */
public final class LoginInfoNormalizer {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  /** ChatGPT 로그인의 tokens 안에서 옮겨 담는 키 — 이 밖의 키는 버린다. */
  private static final List<String> CHATGPT_TOKEN_KEYS =
      List.of("id_token", "access_token", "refresh_token", "account_id");

  static final String UNREADABLE = "로그인 정보를 읽지 못했어요 — 파일 내용을 빠짐없이 붙여 넣어 주세요.";
  static final String EMPTY = "로그인 정보를 넣어 주세요.";
  static final String NOT_CHATGPT = "ChatGPT 로 로그인한 정보가 아니에요 — codex login 에서 ChatGPT 로그인을 골라 주세요.";
  static final String NO_REFRESH = "로그인을 이어 갈 정보(갱신 토큰)가 없어요 — codex login 을 다시 해 주세요.";
  static final String GENIA_GIVEN = "Gen:iA 로그인 정보예요 — ChatGPT 로그인 정보를 넣어 주세요.";
  static final String NOT_GENIA = "Gen:iA 로그인 정보가 아니에요 — genia 에서 /login genia 로 로그인해 주세요.";
  static final String CHATGPT_GIVEN = "ChatGPT 로그인 정보예요 — Gen:iA 로그인 정보를 넣어 주세요.";

  private LoginInfoNormalizer() {}

  /**
   * provider 에 맞게 검증하고 다듬은 JSON 문자열을 돌려준다.
   *
   * @param provider {@link AgentProviders#GENIA} 또는 {@link AgentProviders#CHATGPT}
   * @param raw 붙여 넣은 auth.json 내용
   * @throws InvalidProviderCredentialException 형식이 맞지 않음(400)
   */
  public static String normalize(String provider, String raw) {
    if (raw == null || raw.isBlank()) throw new InvalidProviderCredentialException(EMPTY);
    JsonNode root = parseObject(raw.strip());
    ObjectNode out = AgentProviders.CHATGPT.equals(provider) ? chatgpt(root) : genia(root);
    try {
      return MAPPER.writeValueAsString(out);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("로그인 정보를 저장할 수 없습니다");
    }
  }

  /** JSON 객체로 읽는다 — 읽지 못하거나 객체가 아니면 400(원인 문구는 버린다). */
  private static JsonNode parseObject(String text) {
    JsonNode node;
    try {
      node = MAPPER.readTree(text);
    } catch (Exception e) {
      throw new InvalidProviderCredentialException(UNREADABLE);
    }
    if (node == null || !node.isObject()) throw new InvalidProviderCredentialException(UNREADABLE);
    return node;
  }

  /**
   * Codex auth.json — tokens 객체가 있고(Codex 모양), ChatGPT 로그인이고({@link #isChatgptMode})
   * tokens.refresh_token 이 있어야 한다. Codex 모양이 아니면 Gen:iA 모양일 때 GENIA_GIVEN, 아니면 NOT_CHATGPT — 판정 순서는
   * 웹 lib/loginInfo.ts 와 같다(둘 다 있는 섞인 파일은 Codex 로 본다). 결과: {auth_mode: chatgpt, OPENAI_API_KEY:
   * null, tokens:{있는 키만}, last_refresh(있으면)}. API 키 로그인은 받지 않는다(OPENAI_API_KEY 는 늘 null).
   */
  private static ObjectNode chatgpt(JsonNode root) {
    JsonNode tokens = root.path("tokens");
    if (!tokens.isObject()) {
      throw new InvalidProviderCredentialException(
          root.path("genia").isObject() ? GENIA_GIVEN : NOT_CHATGPT);
    }
    if (!isChatgptMode(root)) throw new InvalidProviderCredentialException(NOT_CHATGPT);
    if (isBlankText(tokens.get("refresh_token"))) {
      throw new InvalidProviderCredentialException(NO_REFRESH);
    }
    ObjectNode out = MAPPER.createObjectNode();
    out.put("auth_mode", "chatgpt");
    out.putNull("OPENAI_API_KEY");
    ObjectNode t = out.putObject("tokens");
    for (String key : CHATGPT_TOKEN_KEYS) {
      JsonNode v = tokens.get(key);
      if (v != null && !v.isNull()) t.set(key, v);
    }
    JsonNode lastRefresh = root.get("last_refresh");
    if (lastRefresh != null && !lastRefresh.isNull()) out.set("last_refresh", lastRefresh);
    return out;
  }

  /**
   * ChatGPT 로그인 파일인가 — auth_mode 가 있으면 chatgpt 여야 한다(apikey 등은 아님). 옛 codex 는 auth_mode 키 없이
   * {OPENAI_API_KEY, tokens, last_refresh} 만 쓰므로, 없으면 API 키가 비었을 때(없음·null·빈 문자열) ChatGPT 로그인으로 본다.
   * 웹 lib/loginInfo.ts 와 같은 규칙.
   */
  private static boolean isChatgptMode(JsonNode root) {
    if (root.has("auth_mode")) return "chatgpt".equals(root.path("auth_mode").asText(null));
    JsonNode key = root.get("OPENAI_API_KEY");
    return key == null || key.isNull() || (key.isTextual() && key.asText().isEmpty());
  }

  /**
   * Gen:iA auth.json — genia 객체(type oauth, refresh 있음)만 그대로 남기고 다른 최상위 키는 버린다. genia 객체가 없으면 Codex
   * 모양(tokens 객체)일 때 CHATGPT_GIVEN, 아니면 NOT_GENIA — 웹과 같은 순서(섞인 파일은 Gen:iA 로 본다).
   */
  private static ObjectNode genia(JsonNode root) {
    JsonNode genia = root.path("genia");
    if (!genia.isObject()) {
      throw new InvalidProviderCredentialException(
          root.path("tokens").isObject() ? CHATGPT_GIVEN : NOT_GENIA);
    }
    if (!"oauth".equals(genia.path("type").asText(null)) || isBlankText(genia.get("refresh"))) {
      throw new InvalidProviderCredentialException(NOT_GENIA);
    }
    ObjectNode out = MAPPER.createObjectNode();
    out.set("genia", genia);
    return out;
  }

  /**
   * 다듬어 저장한 로그인 정보에서 계정 이메일을 꺼낸다(메타 표시용, best-effort) — chatgpt 는 tokens.id_token JWT 본문의 email (서명
   * 검증 없음 — 표시만 한다), genia 는 genia.email. 읽지 못하면 null.
   */
  public static String accountEmail(String provider, String stored) {
    try {
      JsonNode root = MAPPER.readTree(stored);
      if (AgentProviders.GENIA.equals(provider)) {
        return textOrNull(root.path("genia").get("email"));
      }
      if (AgentProviders.CHATGPT.equals(provider)) {
        String idToken = textOrNull(root.path("tokens").get("id_token"));
        if (idToken == null) return null;
        String[] parts = idToken.split("\\.");
        if (parts.length < 2) return null;
        byte[] payload = Base64.getUrlDecoder().decode(parts[1]);
        return textOrNull(
            MAPPER.readTree(new String(payload, StandardCharsets.UTF_8)).get("email"));
      }
      return null;
    } catch (Exception e) {
      return null; // 메타 조회는 best-effort — 표시 하나 때문에 응답을 깨뜨리지 않는다.
    }
  }

  private static boolean isBlankText(JsonNode n) {
    return n == null || !n.isTextual() || n.asText().isBlank();
  }

  private static String textOrNull(JsonNode n) {
    return n != null && n.isTextual() && !n.asText().isBlank() ? n.asText() : null;
  }
}
