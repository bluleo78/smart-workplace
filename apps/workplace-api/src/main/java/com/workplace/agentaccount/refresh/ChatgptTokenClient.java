package com.workplace.agentaccount.refresh;

import static com.workplace.auth.service.LoginInfoNormalizer.textOrNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * ChatGPT(Codex 로그인) 토큰 갱신 클라이언트(WP-1450). Codex CLI 와 같은 요청을 보낸다 — {@code POST {tokenUrl}} JSON
 * {@code {client_id, grant_type=refresh_token, refresh_token}}. 응답의 {@code access_token}·{@code
 * id_token}·{@code refresh_token} 을 돌려준다(갱신 토큰은 응답에 없을 수 있다).
 *
 * <p>실패 분류는 Codex 의 {@code classify_refresh_token_failure} 를 따른다 — 401, 400 의 invalid_grant 와 알려진
 * 사유 코드는 영구, 그 밖(5xx·연결 실패·해석 불가 응답)은 일시. 토큰·응답 본문은 예외 메시지에 싣지 않는다.
 */
public class ChatgptTokenClient {

  /** Codex 의 공개 OAuth client id(codex-rs/login CLIENT_ID). */
  static final String CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

  /** 400 응답에서 영구 실패로 보는 사유 코드. */
  private static final Set<String> PERMANENT_CODES =
      Set.of(
          "invalid_grant",
          "refresh_token_expired",
          "refresh_token_reused",
          "refresh_token_invalidated");

  /** 기록해도 되는 사유 코드 모양. */
  private static final Pattern SAFE_CODE = Pattern.compile("[a-z0-9_]{1,64}");

  private static final ObjectMapper MAPPER = new ObjectMapper();

  /** 갱신 결과 — refreshToken 은 응답에 없으면 null(기존 값을 유지한다). 토큰 원문이라 toString 에서 가린다. */
  public record ChatgptTokens(String idToken, String accessToken, String refreshToken) {
    @Override
    public String toString() {
      return "ChatgptTokens[***]";
    }
  }

  private record Raw(int status, byte[] body) {}

  private final RestClient client;
  private final String tokenUrl;

  public ChatgptTokenClient(RestClient client, String tokenUrl) {
    this.client = client;
    this.tokenUrl = tokenUrl;
  }

  /**
   * 갱신 토큰으로 새 토큰을 받는다.
   *
   * @throws ChatgptTokenRefreshException 갱신 실패(영구·일시는 permanent 로 구분)
   */
  public ChatgptTokens refresh(String refreshToken) throws ChatgptTokenRefreshException {
    ObjectNode body = MAPPER.createObjectNode();
    body.put("client_id", CLIENT_ID);
    body.put("grant_type", "refresh_token");
    body.put("refresh_token", refreshToken);

    Raw res;
    try {
      res =
          client
              .post()
              .uri(tokenUrl)
              .contentType(MediaType.APPLICATION_JSON)
              // byte[] 로 보낸다 — 문자열·객체 본문은 Spring 이 DEBUG 로그(「Writing [...]」)에 본문을 그대로 찍어 갱신 토큰이 샌다.
              .body(body.toString().getBytes(StandardCharsets.UTF_8))
              .exchange((req, r) -> new Raw(r.getStatusCode().value(), r.getBody().readAllBytes()));
    } catch (RestClientException | IllegalArgumentException e) {
      // 연결 실패·타임아웃 — 일시. 예외 메시지에 URL·본문이 섞일 수 있어 코드만 남긴다.
      throw new ChatgptTokenRefreshException(false, "network");
    }

    int status = res.status();
    if (status == 401) {
      // 401 은 영구 — 본문에 더 구체적인 사유(refresh_token_reused 등)가 있으면 그 코드를 쓴다.
      String code = errorCode(res.body());
      throw new ChatgptTokenRefreshException(true, code != null ? code : "http_401");
    }
    if (status == 400) {
      String code = errorCode(res.body());
      boolean permanent = code != null && PERMANENT_CODES.contains(code);
      throw new ChatgptTokenRefreshException(permanent, code != null ? code : "http_400");
    }
    if (status < 200 || status >= 300) {
      throw new ChatgptTokenRefreshException(false, "http_" + status);
    }
    try {
      JsonNode json = MAPPER.readTree(res.body());
      String access = textOrNull(json.path("access_token"));
      if (access == null) throw new ChatgptTokenRefreshException(false, "bad_response");
      return new ChatgptTokens(
          textOrNull(json.path("id_token")), access, textOrNull(json.path("refresh_token")));
    } catch (ChatgptTokenRefreshException e) {
      throw e;
    } catch (Exception e) {
      throw new ChatgptTokenRefreshException(false, "bad_response");
    }
  }

  /**
   * 오류 응답에서 사유 코드를 꺼낸다 — {@code {"error":"x"}} 또는 {@code {"error":{"code":"x"}}}. 없거나 해석 불가면 null.
   */
  private static String errorCode(byte[] body) {
    try {
      JsonNode error = MAPPER.readTree(body).path("error");
      String code = error.isTextual() ? error.asText() : textOrNull(error.path("code"));
      // 서버가 준 문자열은 믿지 않는다 — 소문자·숫자·밑줄 1~64자만 코드로 받고, 아니면 null(호출자가 http_<상태> 로 대신한다).
      // 길이 제한은 error_code 칸(64) 때문이고, 형식 제한은 서버가 되돌려 준 임의 문구(토큰 등)가 기록·로그에 실리지 않게 하기 위함.
      return code != null && SAFE_CODE.matcher(code).matches() ? code : null;
    } catch (Exception e) {
      return null;
    }
  }
}
