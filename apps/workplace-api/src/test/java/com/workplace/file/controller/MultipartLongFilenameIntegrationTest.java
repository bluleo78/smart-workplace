package com.workplace.file.controller;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * 긴 파일명 multipart 업로드(WP-560, 홈 첨부 선업로드 경로로 확인) — 실제 Tomcat 이 파트 머리글을 파싱하는 경로를 RANDOM_PORT 로
 * 검증한다(MockMvc 는 multipart 파싱을 건너뛰어 재현되지 않는다).
 *
 * <p>Tomcat 기본 파트 머리글 한도(512B)는 한글 150자 파일명(UTF-8 450B)만으로 넘쳐, 70바이트 파일이 「파일 크기 초과」로 거절됐다.
 */
class MultipartLongFilenameIntegrationTest extends IntegrationTestBase {

  @Autowired private JwtTokenProvider jwt;
  @Autowired private ObjectMapper om;
  @LocalServerPort private int port;

  private long userId;

  @BeforeEach
  void seed() {
    userId = withMembership(TestFixtures.createHuman(baseDsl));
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          baseDsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.eq(userId)).execute();
          baseDsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
        });
  }

  /** 한글 150자 파일명 — 머리글 한도에 걸리지 않고 그대로 저장된다. */
  @Test
  void koreanFilenameOf150Chars_uploads() throws Exception {
    String name = "가".repeat(150) + ".png";
    HttpResponse<String> res = upload(name);
    assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
    JsonNode body = om.readTree(res.body());
    assertThat(body.get(0).get("originalName").asText()).isEqualTo(name);
  }

  /** 머리글 한도까지 넘는 파일명 — 「크기 초과」가 아니라 파일 이름이 너무 길다고 안내한다. */
  @Test
  void filenameBeyondHeaderLimit_saysNameTooLong() throws Exception {
    HttpResponse<String> res = upload("가".repeat(4000) + ".png");
    assertThat(res.statusCode()).isEqualTo(400);
    String message = om.readTree(res.body()).get("message").asText();
    assertThat(message).contains("파일 이름").doesNotContain("크기");
  }

  private HttpResponse<String> upload(String filename) throws Exception {
    String boundary = "----wp560boundary";
    ByteArrayOutputStream body = new ByteArrayOutputStream();
    body.write(
        ("--"
                + boundary
                + "\r\nContent-Disposition: form-data; name=\"files\"; filename=\""
                + filename
                + "\"\r\nContent-Type: image/png\r\n\r\n")
            .getBytes(StandardCharsets.UTF_8));
    body.write(new byte[70]);
    body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
    HttpRequest req =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/home/attachments"))
            .header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u", 1L))
            .header("Content-Type", "multipart/form-data; boundary=" + boundary)
            .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
            .build();
    return HttpClient.newHttpClient()
        .send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
