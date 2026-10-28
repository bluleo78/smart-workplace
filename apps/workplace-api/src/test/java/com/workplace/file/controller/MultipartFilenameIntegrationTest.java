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
 * multipart 파일명 처리(홈 첨부 선업로드 경로로 확인) — 실제 Tomcat 이 파트 머리글을 파싱하는 경로를 RANDOM_PORT 로 검증한다(MockMvc 는
 * multipart 파싱·해석기를 건너뛰어 재현되지 않는다).
 *
 * <ul>
 *   <li>긴 파일명(WP-560): Tomcat 기본 파트 머리글 한도(512B)는 한글 150자 파일명(UTF-8 450B)만으로 넘쳐, 70바이트 파일이 「파일 크기
 *       초과」로 거절됐다.
 *   <li>브라우저 이스케이프(WP-1074): 브라우저는 파일명의 큰따옴표·CR·LF 를 %22·%0D·%0A 로 보낸다 — 해석기가 되돌려 저장한다. 해석기는 모든 업로드
 *       경로에 같게 걸린다.
 * </ul>
 */
class MultipartFilenameIntegrationTest extends IntegrationTestBase {

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

  /** 브라우저가 보낸 %22 는 큰따옴표로 되돌려 저장된다 — 이전에는 「%22」가 이름에 그대로 남았다(WP-1074). */
  @Test
  void escapedQuote_isStoredAsQuote() throws Exception {
    assertThat(uploadedName("filename=\"보고서 %22최종%22.txt\"")).isEqualTo("보고서 \"최종\".txt");
  }

  /** 줄바꿈 이스케이프(%0D·%0A)는 "_" 로 — 줄을 바꾸는 이름이 저장·오류 문구에 들어가지 않는다. */
  @Test
  void escapedLineBreak_becomesUnderscore() throws Exception {
    assertThat(uploadedName("filename=\"a%0D%0Ab.txt\"")).isEqualTo("a__b.txt");
  }

  /** 이스케이프가 아닌 % 는 그대로 둔다(소문자 %0a 도 표준 이스케이프가 아니다). */
  @Test
  void otherPercentSequences_areKept() throws Exception {
    assertThat(uploadedName("filename=\"100% 완료 %41 %0a.txt\"")).isEqualTo("100% 완료 %41 %0a.txt");
  }

  /** filename*=(RFC 5987) 는 이미 퍼센트 디코딩된 값이라 다시 풀지 않는다 — 글자 그대로의 %22 가 남는다. */
  @Test
  void rfc5987Filename_isNotDecodedTwice() throws Exception {
    assertThat(uploadedName("filename*=UTF-8''report%2522v2.txt")).isEqualTo("report%22v2.txt");
  }

  private String uploadedName(String filenameParam) throws Exception {
    HttpResponse<String> res = uploadRaw(filenameParam);
    assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
    return om.readTree(res.body()).get(0).get("originalName").asText();
  }

  private HttpResponse<String> upload(String filename) throws Exception {
    return uploadRaw("filename=\"" + filename + "\"");
  }

  /** 파트 머리글의 파일명 부분(filenameParam)을 그대로 넣어 보낸다 — 따옴표 형식·RFC 5987 형식을 고를 수 있게. */
  private HttpResponse<String> uploadRaw(String filenameParam) throws Exception {
    String boundary = "----wp560boundary";
    ByteArrayOutputStream body = new ByteArrayOutputStream();
    body.write(
        ("--"
                + boundary
                + "\r\nContent-Disposition: form-data; name=\"files\"; "
                + filenameParam
                + "\r\nContent-Type: image/png\r\n\r\n")
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
