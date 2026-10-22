package com.workplace.global.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.support.IntegrationTestBase;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;

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
    assertThat(body.get("message").asText()).matches(".*[가-힣].*");
  }

  @Test
  void 너무_긴_검색어는_한국어_JSON_400() throws Exception {
    String q = URLEncoder.encode("가".repeat(3000), StandardCharsets.UTF_8);
    HttpResponse<String> res = get("/api/v1/admin/audit-logs?search=" + q, null, null);
    assertKoreanJson400(res);
    assertThat(om.readTree(res.body()).get("message").asText()).contains("너무 길거나");
  }

  @Test
  void 경로의_인코딩된_슬래시는_한국어_JSON_400() throws Exception {
    assertKoreanJson400(get("/api/v1/projects/SEC%2Fissues/1", null, null));
  }

  @Test
  void 너무_큰_머리글은_한국어_JSON_400() throws Exception {
    assertKoreanJson400(get("/api/v1/health", "X-Big", "a".repeat(20_000)));
  }
}
