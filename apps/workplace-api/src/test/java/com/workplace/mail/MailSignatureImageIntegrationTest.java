package com.workplace.mail;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MAIL_SIGNATURE_IMAGE;
import static com.workplace.jooq.Tables.TENANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.file.api.StagedFileClaimer;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.FixtureHttpFetcherConfig;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메일 서명 이미지(WP-1517) 통합 — data:·외부 이미지를 받아 저장하고 경로로 바꾸기, 형식·크기·개수 상한, 내 경로 유지, 남의 경로 빼기·404, 본인만
 * 읽기, 발송용 사본(stage)이 작성창 업로드로 클레임 가능한지.
 *
 * <p>외부 이미지는 통합 테스트 공통 가져오기({@link FixtureHttpFetcherConfig})의 고정 응답을 쓴다 — 고정 URL 외에는 받기 실패다.
 */
@Transactional
class MailSignatureImageIntegrationTest extends ExternalClientMockedTestBase {

  /** 1×1 PNG. */
  static final String PNG_BASE64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  static final byte[] PNG = Base64.getDecoder().decode(PNG_BASE64);

  static final Pattern IMAGE_SRC =
      Pattern.compile("src=\"(/api/v1/mail/signature/images/(\\d+))\"");

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired StagedFileClaimer claimer;

  /** 테넌트#1 토큰 — 실제 요청처럼 JwtAuthenticationFilter 가 TenantContext 를 정한다. */
  String bearer(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L);
  }

  /** 테넌트#1 멤버 사용자. */
  long user() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  /** MockMvc 요청 — JwtAuthenticationFilter 가 요청 끝에 지운 테스트 스레드의 TenantContext 를 되돌린다. */
  ResultActions http(RequestBuilder rb) throws Exception {
    try {
      return mvc.perform(rb);
    } finally {
      TenantContext.set(1L);
    }
  }

  JsonNode putHtml(long userId, String html) throws Exception {
    Map<String, Object> b = new HashMap<>();
    b.put("html", html);
    b.put("autoNew", true);
    b.put("autoReply", false);
    ResultActions r =
        http(put("/api/v1/mail/signature")
                .header("Authorization", bearer(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(b)))
            .andExpect(status().isOk());
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }

  ResultActions getImage(long userId, String path) throws Exception {
    return http(get(path).header("Authorization", bearer(userId)));
  }

  ResultActions stage(long userId, String body) throws Exception {
    return http(
        post("/api/v1/mail/signature/images/stage")
            .header("Authorization", bearer(userId))
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
  }

  static String dataUri(String mime, byte[] bytes) {
    return "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(bytes);
  }

  /** PNG 머리 뒤에 채움 바이트를 붙여 원하는 크기의 (형식 판정을 통과하는) PNG 바이트를 만든다. */
  static byte[] pngOfSize(int size, int seed) {
    byte[] b = Arrays.copyOf(PNG, size);
    b[size - 1] = (byte) seed;
    return b;
  }

  static List<String> imagePaths(String html) {
    List<String> out = new ArrayList<>();
    Matcher m = IMAGE_SRC.matcher(html);
    while (m.find()) out.add(m.group(1));
    return out;
  }

  int imageRows(long userId) {
    return dsl.fetchCount(MAIL_SIGNATURE_IMAGE, MAIL_SIGNATURE_IMAGE.USER_ID.eq(userId));
  }

  @Test
  void data_URI_이미지를_저장하고_경로로_바꾼다() throws Exception {
    long me = user();

    JsonNode saved = putHtml(me, "<p><img src=\"" + dataUri("image/png", PNG) + "\">홍길동</p>");

    String html = saved.get("html").asText();
    List<String> paths = imagePaths(html);
    assertThat(paths).hasSize(1);
    assertThat(paths.get(0)).matches("^/api/v1/mail/signature/images/\\d+$");
    assertThat(html).doesNotContain("data:");
    assertThat(saved.get("droppedImageCount").asInt()).isZero();

    byte[] body =
        getImage(me, paths.get(0))
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Type", "image/png"))
            .andExpect(header().string("Content-Disposition", "inline"))
            .andExpect(header().string("Content-Security-Policy", "sandbox"))
            .andExpect(header().string("Cache-Control", "private, max-age=86400"))
            .andReturn()
            .getResponse()
            .getContentAsByteArray();
    assertThat(body).isEqualTo(PNG);
  }

  @Test
  void PNG라_적고_HTML을_넣으면_뺀다() throws Exception {
    long me = user();
    byte[] html = "<html><script>alert(1)</script></html>".getBytes();

    JsonNode saved = putHtml(me, "<img src=\"" + dataUri("image/png", html) + "\"><p>x</p>");

    assertThat(saved.get("droppedImageCount").asInt()).isEqualTo(1);
    assertThat(saved.get("html").asText()).doesNotContain("<img");
    assertThat(imageRows(me)).isZero();
  }

  @Test
  void 외부_https_이미지는_받아_저장한다() throws Exception {
    long me = user();

    JsonNode saved =
        putHtml(me, "<p><img src=\"" + FixtureHttpFetcherConfig.SIGNATURE_GIF + "\"></p>");

    List<String> paths = imagePaths(saved.get("html").asText());
    assertThat(paths).hasSize(1);
    byte[] body =
        getImage(me, paths.get(0))
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Type", "image/gif"))
            .andReturn()
            .getResponse()
            .getContentAsByteArray();
    assertThat(body).isEqualTo(FixtureHttpFetcherConfig.GIF);
  }

  @Test
  void 외부_받기_실패는_빼고_센다() throws Exception {
    long me = user();

    JsonNode saved = putHtml(me, "<p><img src=\"https://fixture.test/없는-이미지.png\">x</p>");

    assertThat(saved.get("droppedImageCount").asInt()).isEqualTo(1);
    assertThat(saved.get("html").asText()).doesNotContain("<img");
  }

  @Test
  void file_blob_cid_이미지는_빼고_센다() throws Exception {
    long me = user();

    JsonNode saved =
        putHtml(
            me,
            "<p><img src=\"file:///C:/Users/a/image001.png\"><img src=\"blob:https://x/1\">"
                + "<img src=\"cid:image001.png@01D\">x</p>");

    assertThat(saved.get("droppedImageCount").asInt()).isEqualTo(3);
  }

  @Test
  void 한장_512KB_초과는_빼고_센다() throws Exception {
    long me = user();
    byte[] big = pngOfSize(512 * 1024 + 1, 1);

    JsonNode saved = putHtml(me, "<p><img src=\"" + dataUri("image/png", big) + "\">x</p>");

    assertThat(saved.get("droppedImageCount").asInt()).isEqualTo(1);
    assertThat(imageRows(me)).isZero();
  }

  @Test
  void 열한번째_이미지는_빼고_센다() throws Exception {
    long me = user();
    StringBuilder html = new StringBuilder("<p>");
    for (int i = 0; i < 11; i++) {
      html.append("<img src=\"").append(dataUri("image/png", pngOfSize(100, i))).append("\">");
    }
    html.append("</p>");

    JsonNode saved = putHtml(me, html.toString());

    assertThat(saved.get("droppedImageCount").asInt()).isEqualTo(1);
    assertThat(imagePaths(saved.get("html").asText())).hasSize(10);
    assertThat(imageRows(me)).isEqualTo(10);
  }

  @Test
  void 이미지_합계_1MB를_넘는_것은_빼고_센다() throws Exception {
    long me = user();
    StringBuilder html = new StringBuilder("<p>");
    for (int i = 0; i < 3; i++) {
      html.append("<img src=\"")
          .append(dataUri("image/png", pngOfSize(400 * 1024, i)))
          .append("\">");
    }
    html.append("</p>");

    JsonNode saved = putHtml(me, html.toString());

    assertThat(saved.get("droppedImageCount").asInt()).isEqualTo(1);
    assertThat(imageRows(me)).isEqualTo(2);
  }

  @Test
  void 같은_이미지가_두번_나오면_한번만_저장한다() throws Exception {
    long me = user();
    String src = dataUri("image/png", PNG);

    JsonNode saved = putHtml(me, "<p><img src=\"" + src + "\"><img src=\"" + src + "\"></p>");

    List<String> paths = imagePaths(saved.get("html").asText());
    assertThat(paths).hasSize(2);
    assertThat(paths.get(0)).isEqualTo(paths.get(1));
    assertThat(imageRows(me)).isEqualTo(1);
  }

  @Test
  void 이미_내_경로인_img는_그대로() throws Exception {
    long me = user();
    String first =
        putHtml(me, "<p><img src=\"" + dataUri("image/png", PNG) + "\"></p>").get("html").asText();

    JsonNode again = putHtml(me, first);

    assertThat(again.get("html").asText()).isEqualTo(first);
    assertThat(again.get("droppedImageCount").asInt()).isZero();
    assertThat(imageRows(me)).isEqualTo(1);
  }

  @Test
  void 남의_이미지_경로는_빼고_GET은_404() throws Exception {
    long a = user();
    long b = user();
    String aPath =
        imagePaths(
                putHtml(a, "<p><img src=\"" + dataUri("image/png", PNG) + "\"></p>")
                    .get("html")
                    .asText())
            .get(0);

    JsonNode saved = putHtml(b, "<p><img src=\"" + aPath + "\">x</p>");

    assertThat(saved.get("droppedImageCount").asInt()).isEqualTo(1);
    assertThat(saved.get("html").asText()).doesNotContain("<img");
    getImage(b, aPath)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("SIGNATURE_IMAGE_NOT_FOUND"));
    getImage(a, "/api/v1/mail/signature/images/999999999").andExpect(status().isNotFound());
  }

  @Test
  void stage는_작성창_업로드를_만들고_발송에_쓸_수_있다() throws Exception {
    long me = user();
    String path =
        imagePaths(
                putHtml(me, "<p><img src=\"" + dataUri("image/png", PNG) + "\"></p>")
                    .get("html")
                    .asText())
            .get(0);
    long imageId = Long.parseLong(path.substring(path.lastIndexOf('/') + 1));

    JsonNode staged =
        om.readTree(
            stage(me, "{\"imageIds\":[" + imageId + "," + imageId + "]}")
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());

    assertThat(staged).hasSize(1);
    assertThat(staged.get(0).get("imageId").asLong()).isEqualTo(imageId);
    long uploadId = staged.get(0).get("uploadId").asLong();
    var row = dsl.selectFrom(FILE).where(FILE.ID.eq(uploadId)).fetchOne();
    assertThat(row.getUploadedBy()).isEqualTo(me);
    assertThat(row.getMimeType()).isEqualTo("image/png");
    assertThat(row.getSizeBytes()).isEqualTo(PNG.length);
    assertThat(row.getStoragePath()).contains("/staged/");
    // 스테이징 규칙으로 클레임 가능 = 발송(attachmentIds·inlineUploads)에 쓸 수 있다
    assertThat(
            claimer.requireClaimable(me, List.of(uploadId), StagedFileClaimer.Retention.PERMANENT))
        .hasSize(1);
  }

  @Test
  void 남의_이미지를_stage하면_404이고_업로드가_생기지_않는다() throws Exception {
    long a = user();
    long b = user();
    String aPath =
        imagePaths(
                putHtml(a, "<p><img src=\"" + dataUri("image/png", PNG) + "\"></p>")
                    .get("html")
                    .asText())
            .get(0);
    long aImage = Long.parseLong(aPath.substring(aPath.lastIndexOf('/') + 1));
    String bPath =
        imagePaths(
                putHtml(b, "<p><img src=\"" + dataUri("image/png", pngOfSize(64, 7)) + "\"></p>")
                    .get("html")
                    .asText())
            .get(0);
    long bImage = Long.parseLong(bPath.substring(bPath.lastIndexOf('/') + 1));

    stage(b, "{\"imageIds\":[" + bImage + "," + aImage + "]}")
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("SIGNATURE_IMAGE_NOT_FOUND"));

    assertThat(dsl.fetchCount(FILE, FILE.UPLOADED_BY.eq(b))).isZero();
  }

  @Test
  void stage_목록이_비었거나_20개를_넘으면_400() throws Exception {
    long me = user();
    StringBuilder ids = new StringBuilder();
    for (int i = 1; i <= 21; i++) {
      if (i > 1) ids.append(',');
      ids.append(i);
    }

    stage(me, "{\"imageIds\":[]}").andExpect(status().isBadRequest());
    stage(me, "{}").andExpect(status().isBadRequest());
    stage(me, "{\"imageIds\":[" + ids + "]}").andExpect(status().isBadRequest());
  }

  @Test
  void 저장_한도가_찬_테넌트는_서명_이미지를_쓰지_않고_409() throws Exception {
    long me = user();
    // 한도 0 — 이미 쓰고 있는 바이트만으로 넘으므로 어떤 새 바이트도 받지 않는다(트랜잭션 테스트라 끝나면 되돌려진다).
    dsl.update(TENANT).set(TENANT.QUOTA_BYTES, 0L).where(TENANT.ID.eq(1L)).execute();
    Map<String, Object> b = new HashMap<>();
    b.put("html", "<p><img src=\"" + dataUri("image/png", PNG) + "\">x</p>");
    b.put("autoNew", true);
    b.put("autoReply", false);

    http(put("/api/v1/mail/signature")
            .header("Authorization", bearer(me))
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(b)))
        .andExpect(status().isConflict());

    assertThat(imageRows(me)).isZero();
  }

  @Test
  void data_이미지를_여러장_붙여_요청이_3MB를_넘어도_넘치는_것만_빼고_센다() throws Exception {
    long me = user();
    // 400KB 이미지 12장 — base64 로 6.5M 자. 앞 2장만 합계 1MB 안에 들고, 나머지(합계 초과 8장 + 개수 초과 2장)는 빠진다.
    StringBuilder html = new StringBuilder("<p>서명");
    for (int i = 0; i < 12; i++) {
      html.append("<img src=\"")
          .append(dataUri("image/png", pngOfSize(400 * 1024, i)))
          .append("\">");
    }
    html.append("</p>");
    assertThat(html.length()).isGreaterThan(3 * 1024 * 1024);

    JsonNode saved = putHtml(me, html.toString());

    assertThat(saved.get("droppedImageCount").asInt()).isEqualTo(10);
    assertThat(imagePaths(saved.get("html").asText())).hasSize(2);
    assertThat(imageRows(me)).isEqualTo(2);
  }
}
