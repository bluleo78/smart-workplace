package com.workplace.wiki;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.file.storage.FileStore;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiAttachmentResponse;
import com.workplace.wiki.service.WikiAttachmentService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WikiAttachmentController + WikiAttachmentService 통합 테스트. 실 JWT 발급 + MockMvc 로 전체 보안 체인을 통과시키고,
 * 승격(promote)은 서비스를 직접 호출해 DB 상태(file.expires_at)를 검증한다.
 *
 * <p>업로드 크기/개수 한도는 테스트를 가볍게 하려고 프로퍼티로 낮춰 override 한다(운영 기본값 10MB/50건은 그대로 서비스 코드에 있음).
 */
@AutoConfigureMockMvc
@Transactional
@TestPropertySource(
    properties = {
      "workplace.storage.wiki.max-image-size-bytes=200",
      "workplace.storage.wiki.max-per-page=2"
    })
class WikiAttachmentIntegrationTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiAttachmentService attachmentService;
  @Autowired FileStore fileStore;

  private long ownerId;
  private long editorId;
  private long viewerId;
  private long nonMemberId;
  private long spaceId;
  private long pageId;

  /** PNG 매직바이트(8) + 헤더 채움용 임의 바이트 8, 총 16바이트 이상 — WikiImageSniffer.HEAD_BYTES 판정용. */
  private static final byte[] PNG_MAGIC = {
    (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0
  };

  @BeforeEach
  void setUp() {
    ownerId = createUser("own");
    editorId = createUser("edt");
    viewerId = createUser("vwr");
    nonMemberId = createUser("non");
    spaceId = spaceService.createTeamSpace(ownerId, "첨부 테스트 공간").id();
    spaceService.addMember(ownerId, spaceId, editorId, "EDITOR");
    spaceService.addMember(ownerId, spaceId, viewerId, "VIEWER");
    pageId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "첨부 테스트 페이지")).id();
  }

  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  /**
   * userId 용 access token 발급. 테넌트 클레임을 명시해야 한다 — 2-arg 오버로드는 tenant 없는 토큰을 만들어
   * JwtAuthenticationFilter 가 TenantContext 를 세팅하지 않는다. 그러면 첫 요청은 직전 @BeforeTransaction 이 남긴 잔여
   * TenantContext(1L) 로 우연히 통과하지만, 필터가 요청 종료 시 항상 clear 하므로 같은 테스트 안의 두 번째 이상 요청부터 "테넌트 컨텍스트 없이 파일
   * 경로 생성 불가" 로 실패한다.
   */
  private String tokenFor(long userId) {
    return jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L);
  }

  private MockMultipartFile pngFile(String name, int totalSize) {
    byte[] data = new byte[Math.max(totalSize, PNG_MAGIC.length)];
    System.arraycopy(PNG_MAGIC, 0, data, 0, PNG_MAGIC.length);
    return new MockMultipartFile("file", name, "image/png", data);
  }

  private OffsetDateTime expiresAtOf(long fileId) {
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.EXPIRES_AT);
  }

  /**
   * 디스크 blob 을 직접 지워 "유실"을 재현한다(DB 행은 그대로 둔다) — DriveFileAvailabilityTest.deleteBlobOnDisk 와 동일
   * 패턴(#739).
   */
  private void deleteBlobOnDisk(long fileId) {
    String storagePath =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(fileId))
            .fetchOne(FILE.STORAGE_PATH);
    boolean deleted = fileStore.deleteIfExists(storagePath);
    assertThat(deleted).as("테스트 셋업: 실제로 디스크에서 지워졌어야 한다").isTrue();
  }

  private WikiAttachmentResponse upload(long userId, long targetPageId, MockMultipartFile file)
      throws Exception {
    String body =
        mvc.perform(
                multipart("/api/v1/wiki/pages/" + targetPageId + "/attachments")
                    .file(file)
                    .header("Authorization", "Bearer " + tokenFor(userId)))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return om.readValue(body, WikiAttachmentResponse.class);
  }

  @Test
  void EDITOR_가_PNG_업로드하면_201과_정본_url을_반환한다() throws Exception {
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    assertThat(res.url())
        .isEqualTo("/api/v1/wiki/pages/" + pageId + "/attachments/" + res.fileId() + "/content");
  }

  @Test
  void 업로드_직후_file_expires_at_은_NOT_NULL_이다() throws Exception {
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    assertThat(expiresAtOf(res.fileId())).isNotNull();
  }

  @Test
  void VIEWER_가_업로드_시도하면_403() throws Exception {
    mvc.perform(
            multipart("/api/v1/wiki/pages/" + pageId + "/attachments")
                .file(pngFile("a.png", 50))
                .header("Authorization", "Bearer " + tokenFor(viewerId)))
        .andExpect(status().isForbidden());
  }

  @Test
  void 비멤버가_content_조회하면_404() throws Exception {
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    mvc.perform(
            get("/api/v1/wiki/pages/" + pageId + "/attachments/" + res.fileId() + "/content")
                .header("Authorization", "Bearer " + tokenFor(nonMemberId)))
        .andExpect(status().isNotFound());
  }

  @Test
  void VIEWER_가_content_조회하면_200_inline() throws Exception {
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    mvc.perform(
            get("/api/v1/wiki/pages/" + pageId + "/attachments/" + res.fileId() + "/content")
                .header("Authorization", "Bearer " + tokenFor(viewerId)))
        .andExpect(status().isOk())
        .andExpect(
            header().string("Content-Disposition", org.hamcrest.Matchers.startsWith("inline")));
  }

  @Test
  void 디스크_blob이_유실된_첨부는_content_조회시_500이_아니라_404를_반환한다() throws Exception {
    // #739 — file 행은 있으나 디스크 바이너리가 없는 경우, FileSystemResource 를 그대로 반환하면 응답 스트리밍 단계에서
    // 500 이 난다. WikiAttachmentStorage.load() 가 FileBlobMissingException 을 던지고 이미 있는 전역 핸들러가
    // 404 + 유실 메시지로 매핑해야 한다(file 코어의 다른 모든 소비처와 동일 계약).
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    deleteBlobOnDisk(res.fileId());

    mvc.perform(
            get("/api/v1/wiki/pages/" + pageId + "/attachments/" + res.fileId() + "/content")
                .header("Authorization", "Bearer " + tokenFor(viewerId)))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("파일 원본이 유실되어 복구할 수 없습니다"));
  }

  @Test
  void 다른_페이지의_pageId로_content_조회하면_바인딩_불일치_404() throws Exception {
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    long otherPageId =
        pageService.create(ownerId, spaceId, new CreatePageRequest(null, "다른 페이지")).id();
    mvc.perform(
            get("/api/v1/wiki/pages/" + otherPageId + "/attachments/" + res.fileId() + "/content")
                .header("Authorization", "Bearer " + tokenFor(ownerId)))
        .andExpect(status().isNotFound());
  }

  @Test
  void SVG_업로드는_이미지_ContentType으로_보내도_400() throws Exception {
    var svg =
        new MockMultipartFile(
            "file",
            "a.svg",
            "image/svg+xml",
            "<svg xmlns='http://www.w3.org/2000/svg'></svg>".getBytes(StandardCharsets.UTF_8));
    mvc.perform(
            multipart("/api/v1/wiki/pages/" + pageId + "/attachments")
                .file(svg)
                .header("Authorization", "Bearer " + tokenFor(editorId)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void PNG라고_선언한_HTML_업로드는_400() throws Exception {
    var fakePng =
        new MockMultipartFile(
            "file",
            "a.png",
            "image/png",
            "<html><script>alert(1)</script></html>".getBytes(StandardCharsets.UTF_8));
    mvc.perform(
            multipart("/api/v1/wiki/pages/" + pageId + "/attachments")
                .file(fakePng)
                .header("Authorization", "Bearer " + tokenFor(editorId)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void 크기_초과_업로드는_400() throws Exception {
    // 테스트 프로퍼티로 max-image-size-bytes=200 — 그보다 큰 파일.
    mvc.perform(
            multipart("/api/v1/wiki/pages/" + pageId + "/attachments")
                .file(pngFile("big.png", 300))
                .header("Authorization", "Bearer " + tokenFor(editorId)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void 페이지당_개수_초과는_409() throws Exception {
    // 테스트 프로퍼티로 max-per-page=2.
    upload(editorId, pageId, pngFile("a.png", 50));
    upload(editorId, pageId, pngFile("b.png", 50));
    mvc.perform(
            multipart("/api/v1/wiki/pages/" + pageId + "/attachments")
                .file(pngFile("c.png", 50))
                .header("Authorization", "Bearer " + tokenFor(editorId)))
        .andExpect(status().isConflict());
  }

  @Test
  void promoteReferenced_호출_후_expires_at_이_NULL_이_된다() throws Exception {
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    String body = "![img](" + WikiAttachmentResponse.urlOf(pageId, res.fileId()) + ")";

    attachmentService.promoteReferenced(pageId, body);

    assertThat(expiresAtOf(res.fileId())).isNull();
  }

  @Test
  void 참조를_지우고_다시_promote해도_expires_at_은_NULL로_유지된다_demote_안함() throws Exception {
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    String bodyWithRef = "![img](" + WikiAttachmentResponse.urlOf(pageId, res.fileId()) + ")";
    attachmentService.promoteReferenced(pageId, bodyWithRef);
    assertThat(expiresAtOf(res.fileId())).isNull();

    attachmentService.promoteReferenced(pageId, "참조가 사라진 본문입니다.");

    assertThat(expiresAtOf(res.fileId())).isNull();
  }

  @Test
  void 다른_페이지에_바인딩된_fileId를_본문에_적어도_승격되지_않는다() throws Exception {
    long otherPageId =
        pageService.create(ownerId, spaceId, new CreatePageRequest(null, "다른 페이지")).id();
    var res = upload(editorId, otherPageId, pngFile("a.png", 50));

    // 이 페이지(pageId) 소유가 아닌 fileId 를 본문에 적고 이 페이지 기준으로 promote 시도.
    String body = "![img](" + WikiAttachmentResponse.urlOf(pageId, res.fileId()) + ")";
    attachmentService.promoteReferenced(pageId, body);

    assertThat(expiresAtOf(res.fileId())).isNotNull();
  }

  /**
   * 이 문자열은 apps/workplace-web/src/components/wiki/wikiImageRoundtrip.test.ts 의 '첨부 경로' 케이스가 라운드트립 후
   * 그대로 유지된다고 단언하는 것과 같아야 한다. 한쪽만 바꾸면 업로드는 성공하는데 몇 시간 뒤 blob 이 만료 수거되는 무음 실패가 난다.
   */
  @Test
  void 프론트_마크다운_라운드트립_리터럴을_파서가_인식한다() throws Exception {
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    String body =
        "![스크린샷](/api/v1/wiki/pages/" + pageId + "/attachments/" + res.fileId() + "/content)";

    attachmentService.promoteReferenced(pageId, body);

    assertThat(expiresAtOf(res.fileId())).isNull();
  }

  @Test
  void 페이지_저장시_본문의_이미지가_승격된다() throws Exception {
    // Task 4: WikiPageService.save() 가 promoteReferenced 를 호출하는지 PUT 엔드포인트로 검증(배선 자체가 회귀 지점).
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    String body = "![img](" + WikiAttachmentResponse.urlOf(pageId, res.fileId()) + ")";
    savePage(editorId, pageId, body, 1);

    assertThat(expiresAtOf(res.fileId())).isNull();
  }

  @Test
  void 이미지를_지우고_재저장해도_승격은_회수되지_않는다() throws Exception {
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    String bodyWithImage = "![img](" + WikiAttachmentResponse.urlOf(pageId, res.fileId()) + ")";
    savePage(editorId, pageId, bodyWithImage, 1);
    assertThat(expiresAtOf(res.fileId())).isNull();

    savePage(editorId, pageId, "이미지를 지운 본문입니다.", 2);

    assertThat(expiresAtOf(res.fileId())).isNull();
  }

  @Test
  void body가_null인_제목만_저장도_예외없이_통과한다() throws Exception {
    // title-only 저장은 body 가 현재 저장된 본문으로 대체되므로 promoteReferenced 가 그 값으로 안전하게 호출돼야 한다.
    mvc.perform(
            put("/api/v1/wiki/pages/" + pageId)
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", "Bearer " + tokenFor(editorId))
                .content("{\"title\":\"새 제목\",\"body\":null,\"version\":1,\"snapshot\":false}"))
        .andExpect(status().isOk());
  }

  /** PUT /api/v1/wiki/pages/{id} 로 body/version 을 저장하는 헬퍼. */
  private void savePage(long userId, long targetPageId, String body, int version) throws Exception {
    mvc.perform(
            put("/api/v1/wiki/pages/" + targetPageId)
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", "Bearer " + tokenFor(userId))
                .content(om.writeValueAsString(new SavePageRequest(null, body, version, false))))
        .andExpect(status().isOk());
  }

  @Test
  void 본문에_Long_오버플로_id가_있어도_promote가_예외없이_통과한다() throws Exception {
    // \d{1,19} 는 19자리까지 매칭하는데 19개 9 는 Long.MAX_VALUE(9223372036854775807, 19자리)를 넘는다.
    // tryParseLong 가드가 없으면 여기서 NumberFormatException 이 던져져 페이지 저장 전체가 깨진다(리뷰 지적).
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    String body =
        "![overflow](/api/v1/wiki/pages/9999999999999999999/attachments/1/content)\n"
            + "![real]("
            + WikiAttachmentResponse.urlOf(pageId, res.fileId())
            + ")";

    attachmentService.promoteReferenced(pageId, body);

    // 오버플로 매치는 조용히 스킵되고, 같은 본문의 정상 참조는 그대로 승격돼야 한다.
    assertThat(expiresAtOf(res.fileId())).isNull();
  }

  @Test
  void EDITOR_가_삭제하면_204() throws Exception {
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    mvc.perform(
            delete("/api/v1/wiki/pages/" + pageId + "/attachments/" + res.fileId())
                .header("Authorization", "Bearer " + tokenFor(editorId)))
        .andExpect(status().isNoContent());
    mvc.perform(
            get("/api/v1/wiki/pages/" + pageId + "/attachments/" + res.fileId() + "/content")
                .header("Authorization", "Bearer " + tokenFor(editorId)))
        .andExpect(status().isNotFound());
  }

  @Test
  void VIEWER_가_삭제_시도하면_403() throws Exception {
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    mvc.perform(
            delete("/api/v1/wiki/pages/" + pageId + "/attachments/" + res.fileId())
                .header("Authorization", "Bearer " + tokenFor(viewerId)))
        .andExpect(status().isForbidden());
  }

  @Test
  void EDITOR_가_다른_페이지에_바인딩된_fileId를_삭제하면_바인딩_불일치_404() throws Exception {
    long otherPageId =
        pageService.create(ownerId, spaceId, new CreatePageRequest(null, "다른 페이지")).id();
    var res = upload(editorId, otherPageId, pngFile("a.png", 50));

    // 호출자(editorId)는 이 스페이스의 EDITOR 라 권한 자체는 통과하지만, fileId 가 pageId 에 바인딩돼 있지 않다 — 403 이 아니라
    // 404(존재 은닉).
    mvc.perform(
            delete("/api/v1/wiki/pages/" + pageId + "/attachments/" + res.fileId())
                .header("Authorization", "Bearer " + tokenFor(editorId)))
        .andExpect(status().isNotFound());
  }
}
