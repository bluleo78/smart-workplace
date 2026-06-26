package com.workplace.mail.outbound;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.mail.config.M365GraphProperties;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailSyncException;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;

/**
 * Microsoft Graph API / Azure AD 토큰 엔드포인트 HTTP 클라이언트.
 *
 * <p>AAD 토큰 엔드포인트({@code .../oauth2/v2.0/token})에 form-urlencoded POST 로 토큰을 교환·갱신하고, Graph REST
 * API에 Bearer 인증으로 GET 요청을 전송한다.
 *
 * <p>사용 라이브러리: {@link java.net.http.HttpClient} (JDK 내장, 외부 의존 없음).
 */
@Slf4j
public class GraphApiClient {

  /** Graph API 베이스 URL. */
  private static final String GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

  private final HttpClient http;
  private final ObjectMapper mapper;
  private final M365GraphProperties props;

  public GraphApiClient(HttpClient http, ObjectMapper mapper, M365GraphProperties props) {
    this.http = http;
    this.mapper = mapper;
    this.props = props;
  }

  /**
   * 토큰 교환/갱신 응답 레코드.
   *
   * @param accessToken Graph API 호출용 단기 access_token
   * @param refreshToken AAD 갱신 시 회전되는 refresh_token(없으면 null)
   * @param expiresInSec access_token 유효 시간(초)
   * @param idToken OIDC id_token(없으면 null)
   */
  public record TokenResponse(
      String accessToken, String refreshToken, long expiresInSec, String idToken) {}

  /** Jackson 역직렬화용 내부 DTO — AAD 응답 스네이크케이스. */
  private record AadTokenJson(
      @JsonProperty("access_token") String accessToken,
      @JsonProperty("refresh_token") String refreshToken,
      @JsonProperty("expires_in") Long expiresIn,
      @JsonProperty("id_token") String idToken) {}

  /**
   * OAuth2 인증코드를 access_token / refresh_token 으로 교환한다.
   *
   * @param code OAuth2 인증코드(redirect 파라미터)
   * @return 토큰 응답
   * @throws MailSyncException AAD 오류 응답 또는 네트워크 실패 시
   */
  public TokenResponse exchangeCode(String code) {
    String body =
        buildFormBody(
            Map.of(
                "grant_type",
                "authorization_code",
                "code",
                code,
                "redirect_uri",
                props.redirectUri(),
                "client_id",
                props.clientId(),
                "client_secret",
                props.clientSecret(),
                // openid 필수(id_token 수신) · 읽기 슬라이스 최소 권한 — 단일 출처 상수 참조
                "scope",
                M365GraphProperties.SCOPE));
    return postToken(body);
  }

  /**
   * refresh_token 으로 새 access_token 을 발급받는다.
   *
   * <p>AAD 는 매 갱신마다 refresh_token 을 회전시키므로 응답의 새 refresh_token 을 반드시 재저장해야 한다.
   *
   * @param refreshToken 기존 refresh_token(복호화 평문)
   * @return 토큰 응답(refreshToken 필드가 새 값)
   * @throws MailSyncException AAD 오류 응답 또는 네트워크 실패 시
   */
  public TokenResponse refresh(String refreshToken) {
    String body =
        buildFormBody(
            Map.of(
                "grant_type",
                "refresh_token",
                "refresh_token",
                refreshToken,
                "client_id",
                props.clientId(),
                "client_secret",
                props.clientSecret(),
                // refresh_token 그랜트: AAD가 원래 부여 scope을 재사용하나 명시해도 무방
                // openid·읽기 슬라이스 최소 권한 — 단일 출처 상수. Mail.Send/Calendars.Read 미포함
                "scope",
                M365GraphProperties.SCOPE));
    return postToken(body);
  }

  /**
   * Graph API 에 Bearer 인증으로 GET 요청을 전송한다.
   *
   * @param accessToken 유효한 access_token(복호화 평문)
   * @param url 절대 URL 또는 Graph 상대경로(예: "/me/messages")
   * @param type 응답 JSON 을 역직렬화할 타입
   * @return 역직렬화된 응답 객체
   * @throws MailSyncException HTTP 오류 또는 파싱 실패 시
   */
  public <T> T get(String accessToken, String url, Class<T> type) {
    String absoluteUrl = url.startsWith("http") ? url : GRAPH_BASE_URL + url;
    HttpRequest req =
        HttpRequest.newBuilder()
            .uri(URI.create(absoluteUrl))
            .header("Authorization", "Bearer " + accessToken)
            .header("Accept", "application/json")
            .GET()
            .build();
    try {
      HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
      if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
        // 응답 바디 전체 대신 error 코드만 추출 — 토큰·secret 등 민감 정보 로그 노출 방지
        log.error(
            "Graph API 오류: status={} errorCode={}",
            resp.statusCode(),
            extractErrorCode(resp.body()));
        throw new MailSyncException("Graph API 호출 실패: " + resp.statusCode());
      }
      return mapper.readValue(resp.body(), type);
    } catch (MailSyncException e) {
      throw e;
    } catch (IOException e) {
      throw new MailSyncException("Graph API 네트워크 오류", e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new MailSyncException("Graph API 요청이 중단됨", e);
    }
  }

  /**
   * MIME 메시지를 Graph로 발송한다(POST /me/sendMail, base64 MIME).
   *
   * <p>JSON Message가 아닌 raw MIME 모드를 쓰는 이유: Graph의 internetMessageHeaders는 x- 접두 커스텀 헤더만 허용해
   * In-Reply-To/References 표준 헤더를 거부한다. base64 MIME 모드는 우리가 헤더를 직접 제어하므로 SMTP 경로와 동일한 스레딩을 유지한다.
   * Graph는 saveToSentItems 기본 동작으로 서버 Sent 폴더에 자동 저장한다.
   *
   * @param accessToken Mail.Send scope 를 포함한 유효 access_token(평문)
   * @param base64Mime base64 인코딩된 완전한 MIME 메시지
   * @throws MailSendException 2xx 외 응답 또는 네트워크 실패
   */
  public void sendMail(String accessToken, String base64Mime) {
    HttpRequest req =
        HttpRequest.newBuilder()
            .uri(URI.create(GRAPH_BASE_URL + "/me/sendMail"))
            .header("Authorization", "Bearer " + accessToken)
            .header("Content-Type", "text/plain")
            .POST(HttpRequest.BodyPublishers.ofString(base64Mime))
            .build();
    sendWrite(req, "sendMail");
  }

  /**
   * Graph 리소스에 PATCH 요청을 전송한다(예: 메시지 isRead 갱신).
   *
   * @param accessToken Mail.ReadWrite scope 를 포함한 유효 access_token(평문)
   * @param path Graph 상대경로(예: "/me/messages/{id}")
   * @param jsonBody application/json 본문
   * @throws MailSendException 2xx 외 응답 또는 네트워크 실패
   */
  public void patch(String accessToken, String path, String jsonBody) {
    HttpRequest req =
        HttpRequest.newBuilder()
            .uri(URI.create(GRAPH_BASE_URL + path))
            .header("Authorization", "Bearer " + accessToken)
            .header("Content-Type", "application/json")
            .method("PATCH", HttpRequest.BodyPublishers.ofString(jsonBody))
            .build();
    sendWrite(req, "patch");
  }

  /** 쓰기 요청 공통 전송 — 2xx 외에는 민감정보 없이 코드만 로그하고 MailSendException. */
  private void sendWrite(HttpRequest req, String op) {
    try {
      HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
      if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
        log.error(
            "Graph 쓰기 오류: op={} status={} errorCode={}",
            op,
            resp.statusCode(),
            extractErrorCode(resp.body()));
        throw new MailSendException("Graph " + op + " 실패: " + resp.statusCode());
      }
    } catch (MailSendException e) {
      throw e;
    } catch (IOException e) {
      throw new MailSendException("Graph " + op + " 네트워크 오류", e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new MailSendException("Graph " + op + " 요청이 중단됨", e);
    }
  }

  /** AAD 토큰 엔드포인트에 form-urlencoded POST. */
  private TokenResponse postToken(String formBody) {
    String tokenUrl =
        "https://login.microsoftonline.com/" + props.tenantId() + "/oauth2/v2.0/token";
    HttpRequest req =
        HttpRequest.newBuilder()
            .uri(URI.create(tokenUrl))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(formBody))
            .build();
    try {
      HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
      if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
        // 응답 바디 전체 대신 error 코드만 추출 — client_secret 에코·토큰 힌트 등 민감 정보 로그 노출 방지
        log.error(
            "AAD 토큰 오류: status={} errorCode={}", resp.statusCode(), extractErrorCode(resp.body()));
        throw new MailSyncException("AAD 토큰 요청 실패: " + resp.statusCode());
      }
      AadTokenJson json = mapper.readValue(resp.body(), AadTokenJson.class);
      return new TokenResponse(
          json.accessToken(),
          json.refreshToken(),
          json.expiresIn() != null ? json.expiresIn() : 3600L,
          json.idToken());
    } catch (MailSyncException e) {
      throw e;
    } catch (IOException e) {
      throw new MailSyncException("AAD 토큰 네트워크 오류", e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new MailSyncException("AAD 토큰 요청이 중단됨", e);
    }
  }

  /**
   * 에러 응답 바디에서 안전한 오류 코드만 추출한다.
   *
   * <p>Graph API: {"error":{"code":"...","message":"..."}} AAD: {"error":"invalid_grant",...} JSON
   * 파싱 실패 또는 코드 필드 부재 시 null 반환 — 바디 전체는 절대 반환하지 않는다.
   */
  private String extractErrorCode(String body) {
    try {
      com.fasterxml.jackson.databind.JsonNode root = mapper.readTree(body);
      // Graph API 형식: error.code
      com.fasterxml.jackson.databind.JsonNode errorNode = root.path("error");
      if (errorNode.isObject()) {
        com.fasterxml.jackson.databind.JsonNode code = errorNode.path("code");
        return code.isTextual() ? code.asText() : null;
      }
      // AAD 형식: error (문자열)
      if (errorNode.isTextual()) {
        return errorNode.asText();
      }
    } catch (Exception ignored) {
      // 파싱 실패 시 코드 없음 — 바디 전체 노출 방지
    }
    return null;
  }

  /** Map 을 application/x-www-form-urlencoded 형식으로 직렬화한다. */
  private static String buildFormBody(Map<String, String> params) {
    StringBuilder sb = new StringBuilder();
    for (Map.Entry<String, String> entry : params.entrySet()) {
      if (!sb.isEmpty()) sb.append('&');
      sb.append(URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8));
      sb.append('=');
      sb.append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8));
    }
    return sb.toString();
  }
}
