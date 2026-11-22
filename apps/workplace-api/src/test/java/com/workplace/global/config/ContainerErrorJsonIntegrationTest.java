package com.workplace.global.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.exception.GlobalExceptionHandler;
import com.workplace.global.exception.InvalidParameterResponses;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 앱 핸들러에 닿기 전에 Tomcat 이 거절하는 요청(WP-732) — 영어 HTML 오류 페이지 대신 앱 공통 형식의 한국어 JSON 으로 답한다.
 *
 * <p>검색칸에 한글 약 880자를 넘게 넣으면 요청 줄이 Tomcat 한도(8KB)를 넘어 「HTTP Status 400 – Bad Request」 영어 HTML 이 왔고,
 * 화면은 원인을 알 수 없었다. 경로의 인코딩된 슬래시·너무 큰 머리글도 같은 컨테이너 단계 거절이다. MockMvc 는 Tomcat 을 거치지 않아 RANDOM_PORT 로
 * 실제 요청을 보낸다.
 */
class ContainerErrorJsonIntegrationTest extends IntegrationTestBase {

  @Autowired private ObjectMapper om;
  @LocalServerPort private int port;
  @Autowired private JwtTokenProvider jwt;

  private final HttpClient http = HttpClient.newHttpClient();

  private HttpResponse<String> get(String pathAndQuery, String headerName, String headerValue)
      throws Exception {
    HttpRequest.Builder b =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + pathAndQuery)).GET();
    if (headerName != null) b.header(headerName, headerValue);
    return http.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  /** 앱 공통 오류 형식(status·message 한국어)의 JSON 인지. */
  private void assertKoreanJson400(HttpResponse<String> res) throws Exception {
    assertThat(res.statusCode()).isEqualTo(400);
    assertThat(res.headers().firstValue("Content-Type").orElse(""))
        .as(res.body())
        .startsWith("application/json");
    JsonNode body = om.readTree(res.body());
    assertThat(body.get("status").asInt()).isEqualTo(400);
    assertThat(body.get("message").asString()).matches(".*[가-힣].*");
  }

  @Test
  void 너무_긴_검색어는_한국어_JSON_400() throws Exception {
    String q = URLEncoder.encode("가".repeat(3000), StandardCharsets.UTF_8);
    HttpResponse<String> res = get("/api/v1/admin/audit-logs?search=" + q, null, null);
    assertKoreanJson400(res);
    assertThat(om.readTree(res.body()).get("message").asString()).contains("너무 길거나");
  }

  @Test
  void 경로의_인코딩된_슬래시는_한국어_JSON_400() throws Exception {
    assertKoreanJson400(get("/api/v1/projects/SEC%2Fissues/1", null, null));
  }

  @Test
  void 너무_큰_머리글은_한국어_JSON_400() throws Exception {
    assertKoreanJson400(get("/api/v1/health", "X-Big", "a".repeat(20_000)));
  }

  /**
   * JSON 을 받지 않는 Accept 의 406(WP-1601) — 앱은 본문 없이 답하고, 밸브가 같은 한국어 문구의 JSON 으로 채운다(MockMvc 는 밸브를 거치지
   * 않아 여기서 실제 요청으로 확인한다).
   */
  @Test
  void 맞지_않는_Accept_의_406_은_한국어_JSON() throws Exception {
    HttpResponse<String> res =
        get("/api/v1/public/drive/share/zzzz/preview-meta", "Accept", "application/xml");
    assertThat(res.statusCode()).isEqualTo(406);
    assertThat(res.headers().firstValue("Content-Type").orElse(""))
        .as(res.body())
        .startsWith("application/json");
    JsonNode body = om.readTree(res.body());
    assertThat(body.get("status").asInt()).isEqualTo(406);
    assertThat(body.get("message").asString())
        .isEqualTo(GlobalExceptionHandler.NOT_ACCEPTABLE_MESSAGE);
  }

  /**
   * 원시 소켓으로 요청 줄을 직접 쓴다(WP-1949) — {@code URI.create} 가 깨진 퍼센트 인코딩을 거절해 HttpClient 로는 보낼 수 없다. 상태
   * 코드와 본문만 파싱한다(Connection: close 라 EOF 까지 읽는다).
   */
  private record Raw(int status, String body) {}

  private Raw rawGet(String pathAndQuery, String bearer) throws Exception {
    try (Socket s = new Socket("localhost", port)) {
      // 서버가 멈춰도 Gradle 시간 제한까지 매달리지 않고 바로 실패하게 읽기 제한을 둔다.
      s.setSoTimeout(10_000);
      StringBuilder req = new StringBuilder();
      req.append("GET ").append(pathAndQuery).append(" HTTP/1.0\r\n");
      req.append("Host: localhost:").append(port).append("\r\n");
      req.append("Accept: application/json\r\n");
      if (bearer != null) req.append("Authorization: Bearer ").append(bearer).append("\r\n");
      req.append("\r\n"); // HTTP/1.0 은 응답 뒤 연결을 닫고 chunked 를 쓰지 않아 EOF 까지 읽으면 본문이 그대로다
      OutputStream out = s.getOutputStream();
      out.write(req.toString().getBytes(StandardCharsets.US_ASCII));
      out.flush();
      InputStream in = s.getInputStream();
      String all = new String(in.readAllBytes(), StandardCharsets.UTF_8);
      assertThat(all).as("서버가 빈 응답을 돌려줌").startsWith("HTTP/");
      int status = Integer.parseInt(all.split(" ", 3)[1]);
      int idx = all.indexOf("\r\n\r\n");
      String body = idx < 0 ? "" : all.substring(idx + 4);
      return new Raw(status, body);
    }
  }

  private void assertInvalidParam400(Raw res) throws Exception {
    assertThat(res.status()).as(res.body()).isEqualTo(400);
    assertThat(res.body()).doesNotContain("Character decoding").doesNotContain("debug level");
    JsonNode body = om.readTree(res.body().substring(res.body().indexOf('{')));
    assertThat(body.get("status").asInt()).isEqualTo(400);
    assertThat(body.get("message").asString())
        .isEqualTo(
            "요청 주소의 매개변수 인코딩이 올바르지 않습니다. 특수문자(%)는 %25 로 인코딩해 주세요."); // 리터럴 고정(WP-1949): 문구가 바뀌면
    // 테스트가 실패하도록 상수를 쓰지 않는다
  }

  private String token() {
    Long userId = createAgentUserWithMembership("wp1949");
    return jwt.generateAccessToken(userId, "u-" + userId, defaultTenantId());
  }

  /**
   * 깨진 퍼센트 인코딩 쿼리는 Tomcat InvalidParameterException(IllegalStateException 하위)이라 409 로 새던 것 → 400
   * 한국어(WP-1949).
   */
  @Test
  void 깨진_퍼센트_인코딩_쿼리는_한국어_JSON_400() throws Exception {
    String t = token();
    assertInvalidParam400(rawGet("/api/v1/projects?search=100%", t));
    assertInvalidParam400(rawGet("/api/v1/projects?search=%zz", t));
    assertInvalidParam400(rawGet("/api/v1/projects?search=%%%%%%", t));
  }

  @Test
  void 정상_인코딩_퍼센트는_400_아님() throws Exception {
    Raw res = rawGet("/api/v1/projects?search=100%25", token());
    assertThat(res.status()).as(res.body()).isEqualTo(200);
  }

  /**
   * 공개 경로는 필터(PublicRateLimitFilter)가 쿼리를 먼저 읽는다. Tomcat 은 쿼리 디코딩 실패를 첫 읽기에서 한 번만 던지고 이후 읽기는 부분 파싱
   * 값을 조용히 돌려주므로(WP-1949), 필터가 삼키면 속도 제한을 건너뛰고 컨트롤러가 실행된다(그러면 404). 400 이 오면 필터가 직접 거절해 컨트롤러에 닿지
   * 않았다는 뜻이다.
   */
  @Test
  void 필터가_먼저_읽는_공개_경로는_컨트롤러에_닿지_않고_한국어_JSON_400() throws Exception {
    assertInvalidParam400(rawGet("/api/v1/public/drive/share/zzzz/preview?start=true&x=%zz", null));
  }

  /** 깨진 매개변수가 start 앞에 와도 같다(파싱 순서 무관). */
  @Test
  void 깨진_매개변수가_start_앞에_와도_공개_경로는_400() throws Exception {
    assertInvalidParam400(rawGet("/api/v1/public/drive/share/zzzz/preview?x=%zz&start=true", null));
  }

  /**
   * 매개변수 개수 초과(Tomcat 기본 한도 10000)는 디코딩 문제가 아니므로 %25 안내가 아닌 일반 안내 400 이어야 한다. 쿼리스트링으로는 요청 줄
   * 한도(8KB)에 먼저 걸려 폼 본문(POST)으로 보낸다.
   */
  @Test
  void 매개변수_개수_초과는_일반_안내_400() throws Exception {
    String form = "a&".repeat(10_001);
    HttpRequest req =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/projects"))
            .header("Authorization", "Bearer " + token())
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(form))
            .build();
    HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
    assertThat(res.statusCode()).as(res.body()).isEqualTo(400);
    JsonNode body = om.readTree(res.body());
    assertThat(body.get("message").asString())
        .isEqualTo("요청 매개변수를 처리할 수 없습니다. 매개변수 개수와 형식을 확인해 주세요.")
        .isNotEqualTo(InvalidParameterResponses.INVALID_ENCODING_MESSAGE);
  }
}
