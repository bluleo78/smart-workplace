package com.workplace.agentaccount.genialogin;

import static com.workplace.auth.service.LoginInfoNormalizer.textOrNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.regex.Pattern;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Gen:iA 브라우저 로그인(PKCE) 서버 클라이언트(WP-1461). {@code POST /auth/login} 으로 로그인을 시작해 인증 주소·state 를 받고,
 * {@code POST /auth/login/token} 을 폴링해 access token 을 받는다.
 *
 * <p>state·code_verifier·access token 은 예외 메시지·로그·toString 에 싣지 않는다(요청 본문은 byte[] 로 보내 Spring DEBUG
 * 로그에도 남지 않게 한다). 테스트에서 spy 로 감쌀 수 있게 final 이 아니다.
 */
public class GeniaLoginClient {

  /** 기록해도 되는 사유 코드 모양. */
  private static final Pattern SAFE_CODE = Pattern.compile("[a-z0-9_]{1,64}");

  private static final ObjectMapper MAPPER = new ObjectMapper();

  /** 서버가 interval·expires_at 을 안 주면 쓰는 기본값. */
  private static final int DEFAULT_INTERVAL_SECONDS = 2;

  private static final long DEFAULT_EXPIRY_MINUTES = 10;

  /** 로그인 시작 결과 — state 는 비밀이라 toString 에서 가린다. */
  public record LoginStart(
      String authorizeUrl, String state, int intervalSeconds, Instant expiresAt) {
    @Override
    public String toString() {
      return "LoginStart[authorizeUrl="
          + authorizeUrl
          + ", state=***, expiresAt="
          + expiresAt
          + "]";
    }
  }

  /** 폴링 결과 — 예외 없이 결과로 분류해 돌려준다. */
  public sealed interface PollResult {
    /** 사용자가 아직 승인하지 않았다. */
    record Pending() implements PollResult {}

    /** 폴링이 너무 잦다 — 간격을 늘려야 한다. */
    record SlowDown() implements PollResult {}

    /** 로그인 요청이 만료됐다. */
    record Expired() implements PollResult {}

    /** 영구 실패(재시도 무의미). code 는 안전한 사유 코드. */
    record Failed(String code) implements PollResult {}

    /** 서버 일시 장애·연결 실패(나중에 다시 시도). */
    record Unavailable(String code) implements PollResult {}

    /** 성공 — accessToken 은 비밀이라 toString 에서 가린다. */
    record Success(String accessToken, Instant expiresAt, String email, String role)
        implements PollResult {
      @Override
      public String toString() {
        return "Success[email=" + email + ", role=" + role + ", expiresAt=" + expiresAt + "]";
      }
    }
  }

  /** 서버에 닿지 못했거나 시작 응답을 쓸 수 없을 때. 메시지에는 코드만 싣는다(URL·본문 없음). */
  public static class GeniaLoginUnavailable extends Exception {
    private final String code;

    public GeniaLoginUnavailable(String code) {
      super(code);
      this.code = code;
    }

    public String code() {
      return code;
    }
  }

  private record Raw(int status, byte[] body) {}

  private final RestClient client;
  private final String serverUrl;
  private final String clientName;

  public GeniaLoginClient(RestClient client, String serverUrl, String clientName) {
    this.client = client;
    this.serverUrl = serverUrl;
    this.clientName = clientName;
  }

  /**
   * 로그인을 시작한다 — code_challenge(S256)와 클라이언트 이름을 보내 인증 주소·state 를 받는다.
   *
   * @throws GeniaLoginUnavailable 연결 실패·비정상 상태·해석 불가 응답
   */
  public LoginStart start(String codeChallenge) throws GeniaLoginUnavailable {
    ObjectNode body = MAPPER.createObjectNode();
    body.put("code_challenge", codeChallenge);
    body.put("client", clientName);
    Raw res = post("/auth/login", body);
    if (res == null) throw new GeniaLoginUnavailable("network");
    if (res.status() < 200 || res.status() >= 300) {
      throw new GeniaLoginUnavailable("http_" + res.status());
    }
    return parseStart(res.body());
  }

  /** 시작 응답 해석 — 인증 주소(http(s) 절대 주소)·state 가 없거나 본문을 못 읽으면 bad_response. */
  private static LoginStart parseStart(byte[] bodyBytes) throws GeniaLoginUnavailable {
    JsonNode json;
    try {
      json = MAPPER.readTree(bodyBytes);
    } catch (IOException e) {
      throw new GeniaLoginUnavailable("bad_response");
    }
    String url = textOrNull(json.path("authorize_url"));
    String state = textOrNull(json.path("state"));
    if (url == null || state == null || !isHttpUrl(url)) {
      throw new GeniaLoginUnavailable("bad_response");
    }
    JsonNode iv = json.path("interval");
    int interval = iv.isInt() && iv.asInt() > 0 ? iv.asInt() : DEFAULT_INTERVAL_SECONDS;
    Instant expires = parseInstant(json.path("expires_at"));
    if (expires == null) expires = Instant.now().plusSeconds(DEFAULT_EXPIRY_MINUTES * 60);
    return new LoginStart(url, state, interval, expires);
  }

  /** state·code_verifier 로 승인 결과를 한 번 조회한다. 예외 없이 {@link PollResult} 로 돌려준다. */
  public PollResult poll(String state, String codeVerifier) {
    ObjectNode body = MAPPER.createObjectNode();
    body.put("state", state);
    body.put("code_verifier", codeVerifier);
    Raw res = post("/auth/login/token", body);
    if (res == null) return new PollResult.Unavailable("network");
    int status = res.status();
    if (status >= 200 && status < 300) return parseSuccess(res.body());
    // 대기·간격·만료는 사유 코드로 구분한다(상태 코드는 400 이지만 서버에 따라 다를 수 있어 코드를 본다).
    String code = errorCode(res.body());
    if ("authorization_pending".equals(code)) return new PollResult.Pending();
    if ("slow_down".equals(code)) return new PollResult.SlowDown();
    if ("expired_token".equals(code)) return new PollResult.Expired();
    // 5xx 와 429(slow_down 이 아닌 일시 제한)는 서버 쪽 일시 상태다 — 영구 실패로 끝내지 않고 다음 간격에 다시 묻게 한다.
    if (status >= 500 || status == 429) return new PollResult.Unavailable("http_" + status);
    return new PollResult.Failed(code != null ? code : "http_" + status);
  }

  /**
   * 인증 주소가 http(s) 절대 주소인지 — 웹이 이 값을 그대로 새 창으로 열므로 javascript:·data:·상대 주소 같은 값은 받지 않는다(서버 응답을 믿지
   * 않는다).
   */
  private static boolean isHttpUrl(String url) {
    try {
      URI uri = new URI(url);
      String scheme = uri.getScheme();
      return uri.isAbsolute()
          && uri.getHost() != null
          && ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme));
    } catch (Exception e) {
      return false;
    }
  }

  /** 성공 응답 해석 — access_token 이 없으면 bad_response. expires_at 이 없으면 null 로 두고 서비스가 기본 수명으로 채운다. */
  private static PollResult parseSuccess(byte[] bodyBytes) {
    try {
      JsonNode json = MAPPER.readTree(bodyBytes);
      String token = textOrNull(json.path("access_token"));
      if (token == null) return new PollResult.Failed("bad_response");
      JsonNode user = json.path("user");
      return new PollResult.Success(
          token,
          parseInstant(json.path("expires_at")),
          textOrNull(user.path("email")),
          textOrNull(user.path("role")));
    } catch (Exception e) {
      return new PollResult.Failed("bad_response");
    }
  }

  /** JSON 본문을 POST 한다. 연결 실패·타임아웃이면 null(예외 메시지에 URL·본문이 섞일 수 있어 버린다). */
  private Raw post(String path, ObjectNode body) {
    try {
      return client
          .post()
          .uri(serverUrl + path)
          .contentType(MediaType.APPLICATION_JSON)
          // byte[] 로 보낸다 — 문자열·객체 본문은 Spring 이 DEBUG 로그에 본문을 그대로 찍어 code_verifier 가 샌다.
          .body(body.toString().getBytes(StandardCharsets.UTF_8))
          .exchange((req, r) -> new Raw(r.getStatusCode().value(), r.getBody().readAllBytes()));
    } catch (RestClientException | IllegalArgumentException e) {
      return null;
    }
  }

  /** 오류 응답의 사유 코드 — {@code error.type}(객체) 또는 {@code error}(문자열). 안전한 모양이 아니면 null. */
  private static String errorCode(byte[] body) {
    try {
      JsonNode error = MAPPER.readTree(body).path("error");
      String code = error.isTextual() ? error.asText() : textOrNull(error.path("type"));
      // 서버가 준 문자열은 믿지 않는다 — 소문자·숫자·밑줄 1~64자만 받아 임의 문구(토큰 등)가 기록에 실리지 않게 한다.
      return code != null && SAFE_CODE.matcher(code).matches() ? code : null;
    } catch (Exception e) {
      return null;
    }
  }

  /** 숫자(1e12 미만은 초, 이상은 밀리초)나 ISO-8601 문자열을 시각으로. 못 읽으면 null. */
  static Instant parseInstant(JsonNode v) {
    if (v == null || v.isMissingNode() || v.isNull()) return null;
    try {
      if (v.isNumber()) {
        long n = v.asLong();
        return n < 1_000_000_000_000L ? Instant.ofEpochSecond(n) : Instant.ofEpochMilli(n);
      }
      if (v.isTextual()) return Instant.parse(v.asText());
    } catch (DateTimeParseException | ArithmeticException e) {
      return null;
    }
    return null;
  }
}
