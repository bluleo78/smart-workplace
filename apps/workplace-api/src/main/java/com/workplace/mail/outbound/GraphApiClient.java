package com.workplace.mail.outbound;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
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
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
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

  /** $batch 요청 타임아웃(WP-188) — 읽음 역동기화 계정 리스 시간(10분)이 조각당 최대 10회 호출을 넉넉히 덮도록 짧게 둔다. */
  static final Duration BATCH_TIMEOUT = Duration.ofSeconds(20);

  /**
   * AAD 토큰 요청 타임아웃(WP-188) — 공용 HttpClient 엔 타임아웃이 없어, 토큰 갱신이 걸리면 트랜잭션 커넥션과 읽음 역동기화 리스를 무기한 붙잡는다.
   */
  static final Duration TOKEN_TIMEOUT = Duration.ofSeconds(20);

  /** 첨부 업로드 요청 타임아웃(WP-574) — 3MB 남짓 조각·첨부 한 건이 느린 회선에서도 끝나도록 넉넉히, 그러나 무기한 걸리지 않게. */
  static final Duration UPLOAD_TIMEOUT = Duration.ofMinutes(2);

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
    return get(accessToken, url, type, Map.of());
  }

  /**
   * {@link #get(String, String, Class)} 에 요청 헤더를 더한 형태 — Graph 의 {@code Prefer} 같은 선택 헤더용(WP-709:
   * 일정 본문을 {@code outlook.body-content-type="text"} 로 받기).
   *
   * @param extraHeaders 추가 요청 헤더(이름 → 값). Authorization·Accept 는 항상 기본값이 먼저 붙는다.
   */
  public <T> T get(
      String accessToken, String url, Class<T> type, Map<String, String> extraHeaders) {
    String absoluteUrl = url.startsWith("http") ? url : GRAPH_BASE_URL + url;
    HttpRequest.Builder builder =
        HttpRequest.newBuilder()
            .uri(URI.create(absoluteUrl))
            .header("Authorization", "Bearer " + accessToken)
            .header("Accept", "application/json");
    extraHeaders.forEach(builder::header);
    HttpRequest req = builder.GET().build();
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
   * WP-986: Graph 리소스의 원문 바이트를 GET 한다 — 메시지 MIME 원문({@code /me/messages/{id}/$value}) 처럼 JSON 이 아닌
   * 응답용.
   *
   * @throws MailSyncException HTTP 오류 또는 네트워크 실패
   */
  public byte[] getBytes(String accessToken, String url) {
    String absoluteUrl = url.startsWith("http") ? url : GRAPH_BASE_URL + url;
    HttpRequest req =
        HttpRequest.newBuilder()
            .uri(URI.create(absoluteUrl))
            .header("Authorization", "Bearer " + accessToken)
            .GET()
            .build();
    try {
      HttpResponse<byte[]> resp = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
      if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
        // 응답 바디는 남기지 않는다 — 토큰·본문 노출 방지
        log.error("Graph API 원문 조회 오류: status={}", resp.statusCode());
        throw new MailSyncException("Graph API 호출 실패: " + resp.statusCode());
      }
      return resp.body();
    } catch (IOException e) {
      throw new MailSyncException("Graph API 네트워크 오류", e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new MailSyncException("Graph API 요청이 중단됨", e);
    }
  }

  /**
   * WP-986: 응답 본문이 없는(202·204) Graph 동작에 POST(application/json) 한다 — 일정 수락·거절({@code
   * /me/events/{id}/accept}) 처럼 결과를 돌려주지 않는 요청용. {@link #post} 는 응답을 역직렬화하므로 빈 본문에서 실패한다.
   *
   * @throws MailSendException 2xx 외 응답 또는 네트워크 실패
   */
  public void postNoContent(String accessToken, String path, String jsonBody) {
    HttpRequest req =
        HttpRequest.newBuilder()
            .uri(URI.create(GRAPH_BASE_URL + path))
            .header("Authorization", "Bearer " + accessToken)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
            .build();
    sendWrite(req, "postNoContent");
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
   * MIME 으로 초안을 만든다(WP-574 큰 메일 경로 1단계 — POST /me/messages, Content-Type text/plain + base64 MIME).
   * sendMail 과 같은 raw MIME 모드라 In-Reply-To/References 스레딩 헤더가 유지된다. 첨부는 뒤이어 attachments API 로 붙인다.
   *
   * @return 만든 초안의 Graph 메시지 id 와 internetMessageId(응답에 있으면)
   * @throws MailSendException 2xx 외 응답·id 없는 응답·네트워크 실패
   */
  public DraftRef createDraftFromMime(String accessToken, String base64Mime) {
    JsonNode draft =
        post(
            accessToken,
            "/me/messages",
            "text/plain",
            HttpRequest.BodyPublishers.ofString(base64Mime),
            JsonNode.class,
            null);
    JsonNode imid = draft.path("internetMessageId");
    return new DraftRef(
        requireText(draft, "id", "createDraft"),
        imid.isTextual() && !imid.asText().isBlank() ? imid.asText() : null);
  }

  /**
   * 만든 초안 참조(WP-574).
   *
   * @param id Graph 메시지 id
   * @param internetMessageId Exchange 가 붙인 RFC Message-ID(꺾쇠 포함 원문, 응답에 없으면 null)
   */
  public record DraftRef(String id, String internetMessageId) {}

  /**
   * 메시지의 internetMessageId 를 읽는다(WP-574 — GET /me/messages/{id}?$select=internetMessageId). 초안 생성
   * 응답에 없을 때 실제 값을 확인하는 데 쓴다.
   *
   * @return 꺾쇠 포함 원문, 없으면 null
   * @throws MailSyncException 2xx 외 응답 또는 네트워크 실패
   */
  public String getInternetMessageId(String accessToken, String messageId) {
    JsonNode node =
        get(
            accessToken,
            "/me/messages/" + messageId + "?$select=internetMessageId",
            JsonNode.class);
    JsonNode imid = node == null ? null : node.path("internetMessageId");
    return imid != null && imid.isTextual() && !imid.asText().isBlank() ? imid.asText() : null;
  }

  /**
   * 초안에 작은 첨부(3MB 미만)를 한 번에 붙인다(WP-574 — POST /me/messages/{id}/attachments, fileAttachment).
   *
   * @throws MailSendException 2xx 외 응답 또는 네트워크 실패
   */
  public void addFileAttachment(
      String accessToken, String messageId, String name, String contentType, byte[] content) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("@odata.type", "#microsoft.graph.fileAttachment");
    body.put("name", name);
    body.put("contentType", contentType);
    body.put("contentBytes", Base64.getEncoder().encodeToString(content));
    post(
        accessToken,
        "/me/messages/" + messageId + "/attachments",
        "application/json",
        HttpRequest.BodyPublishers.ofByteArray(toJsonBytes(body)),
        JsonNode.class,
        UPLOAD_TIMEOUT);
  }

  /**
   * 큰 첨부(3MB 이상) 업로드 세션을 만든다(WP-574 — POST /me/messages/{id}/attachments/createUploadSession).
   *
   * @return 조각을 PUT 할 사전 인증 uploadUrl(Authorization 헤더 없이 쓴다)
   * @throws MailSendException 2xx 외 응답·uploadUrl 없는 응답·네트워크 실패
   */
  public String createAttachmentUploadSession(
      String accessToken, String messageId, String name, String contentType, long size) {
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("attachmentType", "file");
    item.put("name", name);
    item.put("size", size);
    item.put("contentType", contentType);
    JsonNode session =
        post(
            accessToken,
            "/me/messages/" + messageId + "/attachments/createUploadSession",
            "application/json",
            HttpRequest.BodyPublishers.ofByteArray(toJsonBytes(Map.of("AttachmentItem", item))),
            JsonNode.class,
            null);
    return requireText(session, "uploadUrl", "createUploadSession");
  }

  /**
   * 업로드 세션에 한 조각을 PUT 한다(WP-574). uploadUrl 은 사전 인증 URL 이라 Authorization 헤더를 보내지 않는다(보내면 401).
   * Content-Range 는 {@code bytes 시작-끝/전체}(끝 포함), Content-Length 는 HttpClient 가 조각 길이로 채운다. 중간 조각은
   * 200, 마지막 조각은 201 — 둘 다 2xx 로 성공.
   *
   * @param from 조각 시작(포함)
   * @param toExclusive 조각 끝(제외)
   * @throws MailSendException 2xx 외 응답 또는 네트워크 실패
   */
  public void uploadAttachmentChunk(String uploadUrl, byte[] content, int from, int toExclusive) {
    HttpRequest req =
        HttpRequest.newBuilder()
            .uri(URI.create(uploadUrl))
            .header("Content-Type", "application/octet-stream")
            .header(
                "Content-Range", "bytes " + from + "-" + (toExclusive - 1) + "/" + content.length)
            .timeout(UPLOAD_TIMEOUT)
            .PUT(HttpRequest.BodyPublishers.ofByteArray(content, from, toExclusive - from))
            .build();
    sendWrite(req, "uploadChunk");
  }

  /**
   * 초안을 보낸다(WP-574 큰 메일 경로 마지막 단계 — POST /me/messages/{id}/send, 빈 본문). 보낸편지함 저장은 Graph 가 한다.
   *
   * @throws MailSendException 2xx 외 응답 또는 네트워크 실패
   */
  public void sendDraft(String accessToken, String messageId) {
    HttpRequest req =
        HttpRequest.newBuilder()
            .uri(URI.create(GRAPH_BASE_URL + "/me/messages/" + messageId + "/send"))
            .header("Authorization", "Bearer " + accessToken)
            .POST(HttpRequest.BodyPublishers.noBody())
            .build();
    sendWrite(req, "sendDraft");
  }

  /** 요청 본문을 JSON 바이트로 직렬화한다(문자열을 거치지 않아 큰 contentBytes 복사를 줄인다) — 실패는 쓰기 실패로 던진다. */
  private byte[] toJsonBytes(Object body) {
    try {
      return mapper.writeValueAsBytes(body);
    } catch (JsonProcessingException e) {
      throw new MailSendException("Graph 요청 직렬화 실패", e);
    }
  }

  /** 응답 JSON 의 필수 문자열 필드 — 없으면 쓰기 실패. */
  private static String requireText(JsonNode node, String field, String op) {
    JsonNode v = node.path(field);
    if (!v.isTextual() || v.asText().isBlank()) {
      throw new MailSendException("Graph " + op + " 응답에 " + field + " 없음");
    }
    return v.asText();
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

  /**
   * Graph 리소스에 POST(application/json) 요청을 전송하고 2xx 응답 바디를 역직렬화한다.
   *
   * @param accessToken 유효 access_token(평문)
   * @param path Graph 상대경로(예: "/me/calendars/{id}/events")
   * @param jsonBody application/json 본문
   * @param type 응답 역직렬화 타입
   * @return 역직렬화된 응답
   * @throws MailSendException 2xx 외 응답 또는 네트워크 실패
   */
  public <T> T post(String accessToken, String path, String jsonBody, Class<T> type) {
    return post(accessToken, path, jsonBody, type, null);
  }

  /**
   * {@link #post(String, String, String, Class)} 에 요청 타임아웃(null 이면 없음)을 더한 형태. 타임아웃은 네트워크 오류로 던진다.
   */
  private <T> T post(
      String accessToken, String path, String jsonBody, Class<T> type, Duration timeout) {
    return post(
        accessToken,
        path,
        "application/json",
        HttpRequest.BodyPublishers.ofString(jsonBody),
        type,
        timeout);
  }

  /** POST 공통 — 본문 형식·발행자를 받아 보내고 2xx 응답 바디를 역직렬화한다(WP-574 초안·첨부 요청도 이 길을 쓴다). */
  private <T> T post(
      String accessToken,
      String path,
      String contentType,
      HttpRequest.BodyPublisher body,
      Class<T> type,
      Duration timeout) {
    HttpRequest.Builder b =
        HttpRequest.newBuilder()
            .uri(URI.create(GRAPH_BASE_URL + path))
            .header("Authorization", "Bearer " + accessToken)
            .header("Content-Type", contentType)
            .header("Accept", "application/json")
            .POST(body);
    if (timeout != null) {
      b.timeout(timeout);
    }
    HttpRequest req = b.build();
    try {
      HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
      if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
        log.error(
            "Graph post 오류: status={} errorCode={}",
            resp.statusCode(),
            extractErrorCode(resp.body()));
        throw new MailSendException("Graph post 실패: " + resp.statusCode());
      }
      return mapper.readValue(resp.body(), type);
    } catch (MailSendException e) {
      throw e;
    } catch (IOException e) {
      throw new MailSendException("Graph post 네트워크 오류", e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new MailSendException("Graph post 요청이 중단됨", e);
    }
  }

  /**
   * WP-187 Graph JSON batch(POST /$batch, 최대 20건). 최상위 응답이 2xx 가 아니면 예외(호출 측이 대기 유지), 2xx 면 항목별 상태를
   * 돌려준다 — 항목별 429 등은 호출 측이 판정한다. 응답 순서는 요청과 다를 수 있으므로 id 를 그대로 돌려준다.
   *
   * @param accessToken 유효 access_token(평문)
   * @param requests 배치 요청(최대 20건 — 호출 측이 자른다)
   * @return 항목별 (id, status)
   * @throws MailSendException 최상위 2xx 외 응답·네트워크 실패·직렬화 실패
   */
  public List<GraphBatchResponse> batch(String accessToken, List<GraphBatchRequest> requests) {
    List<Map<String, Object>> reqs =
        requests.stream()
            .map(
                r -> {
                  // 배치 규약: body 가 있으면 Content-Type 헤더가 필수
                  Map<String, Object> m = new LinkedHashMap<>();
                  m.put("id", r.id());
                  m.put("method", r.method());
                  m.put("url", r.url());
                  m.put("headers", Map.of("Content-Type", "application/json"));
                  m.put("body", r.body());
                  return m;
                })
            .toList();
    String json;
    try {
      json = mapper.writeValueAsString(Map.of("requests", reqs));
    } catch (JsonProcessingException e) {
      throw new MailSendException("Graph batch 직렬화 실패", e);
    }
    // 요청 타임아웃 — 공용 HttpClient 엔 타임아웃이 없어, 걸린 요청이 읽음 역동기화 계정 리스(WP-188)보다 오래 끌지 않게 끊는다
    JsonNode resp = post(accessToken, "/$batch", json, JsonNode.class, BATCH_TIMEOUT);
    List<GraphBatchResponse> out = new ArrayList<>();
    for (JsonNode n : resp.path("responses")) {
      // 항목 본문은 옮기기(WP-962)처럼 결과 값이 필요한 요청을 위해 함께 싣는다 — 없으면 null
      JsonNode body = n.get("body");
      out.add(
          new GraphBatchResponse(
              n.path("id").asText(),
              n.path("status").asInt(),
              body == null || body.isNull() ? null : body));
    }
    return out;
  }

  /**
   * Graph 리소스에 DELETE 요청을 전송한다. 멱등 삭제이므로 404(이미 없음)는 성공으로 간주한다.
   *
   * @param accessToken 유효 access_token(평문)
   * @param path Graph 상대경로(예: "/me/events/{id}")
   * @throws MailSendException 2xx·404 외 응답 또는 네트워크 실패
   */
  public void delete(String accessToken, String path) {
    HttpRequest req =
        HttpRequest.newBuilder()
            .uri(URI.create(GRAPH_BASE_URL + path))
            .header("Authorization", "Bearer " + accessToken)
            .DELETE()
            .build();
    try {
      HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
      int sc = resp.statusCode();
      // 404 = 이미 삭제됨 → 삭제의 목표 상태이므로 성공 취급
      if (sc == 404) return;
      if (sc < 200 || sc >= 300) {
        log.error("Graph delete 오류: status={} errorCode={}", sc, extractErrorCode(resp.body()));
        throw new MailSendException("Graph delete 실패: " + sc);
      }
    } catch (MailSendException e) {
      throw e;
    } catch (IOException e) {
      throw new MailSendException("Graph delete 네트워크 오류", e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new MailSendException("Graph delete 요청이 중단됨", e);
    }
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
            .timeout(TOKEN_TIMEOUT)
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
