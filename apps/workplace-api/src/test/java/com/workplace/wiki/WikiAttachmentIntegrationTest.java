package com.workplace.wiki;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;
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
  @Autowired com.workplace.drive.service.DriveQuotaService quotaService;
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

  /** 파일 크기(바이트) — 쿼터 집계 단언용. */
  private long sizeOf(long fileId) {
    return dsl.select(FILE.SIZE_BYTES).from(FILE).where(FILE.ID.eq(fileId)).fetchOne(0, Long.class);
  }

  /** #759 강등 표식 — "아직 승격 전(temp)" 과 "승격됐다가 참조가 빠져 유예 중(demoted)" 을 가르는 유일한 표식. */
  private OffsetDateTime demotedAtOf(long fileId) {
    return dsl.select(WIKI_PAGE_ATTACHMENT.DEMOTED_AT)
        .from(WIKI_PAGE_ATTACHMENT)
        .where(WIKI_PAGE_ATTACHMENT.FILE_ID.eq(fileId))
        .fetchOne(WIKI_PAGE_ATTACHMENT.DEMOTED_AT);
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
  void 임시_첨부만으로도_상한을_채우면_409() throws Exception {
    // 테스트 프로퍼티로 max-per-page=2. 저장(promote) 없이 임시 첨부만 올려도 여전히 막혀야 한다
    // (#757 상한 재계산 후에도 버스트 남용은 그대로 차단됨 — tempFileIdsOfPage 가 이 케이스를 커버).
    upload(editorId, pageId, pngFile("a.png", 50));
    upload(editorId, pageId, pngFile("b.png", 50));
    mvc.perform(
            multipart("/api/v1/wiki/pages/" + pageId + "/attachments")
                .file(pngFile("c.png", 50))
                .header("Authorization", "Bearer " + tokenFor(editorId)))
        .andExpect(status().isConflict());
  }

  @Test
  void 상한까지_채워_저장해도_본문에서_지우고_재저장하면_업로드가_다시_가능해진다() throws Exception {
    // #757 핵심 회귀: 예전 countByPage 방식은 매핑이 남아 이 케이스가 영원히 409 였다.
    var a = upload(editorId, pageId, pngFile("a.png", 50));
    var b = upload(editorId, pageId, pngFile("b.png", 50));
    String bodyWithBoth =
        "![a]("
            + WikiAttachmentResponse.urlOf(pageId, a.fileId())
            + ")![b]("
            + WikiAttachmentResponse.urlOf(pageId, b.fileId())
            + ")";
    savePage(editorId, pageId, bodyWithBoth, 1);

    // 상한(2)이 저장된 본문 참조로 이미 다 찼으니 추가 업로드는 409.
    mvc.perform(
            multipart("/api/v1/wiki/pages/" + pageId + "/attachments")
                .file(pngFile("c.png", 50))
                .header("Authorization", "Bearer " + tokenFor(editorId)))
        .andExpect(status().isConflict());

    // 본문에서 이미지를 전부 지우고 저장 — 참조 집합이 비므로 업로드가 다시 가능해야 한다.
    savePage(editorId, pageId, "이미지를 전부 지운 본문입니다.", 2);

    mvc.perform(
            multipart("/api/v1/wiki/pages/" + pageId + "/attachments")
                .file(pngFile("c.png", 50))
                .header("Authorization", "Bearer " + tokenFor(editorId)))
        .andExpect(status().isCreated());
  }

  @Test
  void 본문에서_절반만_지우고_재저장하면_남은_참조만_카운트된다() throws Exception {
    var a = upload(editorId, pageId, pngFile("a.png", 50));
    var b = upload(editorId, pageId, pngFile("b.png", 50));
    String bodyWithBoth =
        "![a]("
            + WikiAttachmentResponse.urlOf(pageId, a.fileId())
            + ")![b]("
            + WikiAttachmentResponse.urlOf(pageId, b.fileId())
            + ")";
    savePage(editorId, pageId, bodyWithBoth, 1);

    // b 참조만 남기고 저장 — 남은 참조(1) + 임시(0) = 1 이라 상한(2) 여유가 생겨야 한다.
    String bodyWithOnlyB = "![b](" + WikiAttachmentResponse.urlOf(pageId, b.fileId()) + ")";
    savePage(editorId, pageId, bodyWithOnlyB, 2);

    mvc.perform(
            multipart("/api/v1/wiki/pages/" + pageId + "/attachments")
                .file(pngFile("c.png", 50))
                .header("Authorization", "Bearer " + tokenFor(editorId)))
        .andExpect(status().isCreated());

    // 위 업로드(c)로 카운트가 b+c=2 가 되어 다시 상한이 찼음을 확인 — "남은 1개가 실제로 세어졌다" 를 고정한다.
    // (제거된 a 가 여전히 카운트에 남아 있었다면 이 시점 이미 3개로 잡혀 앞의 업로드부터 409 였을 것이다.)
    mvc.perform(
            multipart("/api/v1/wiki/pages/" + pageId + "/attachments")
                .file(pngFile("d.png", 50))
                .header("Authorization", "Bearer " + tokenFor(editorId)))
        .andExpect(status().isConflict());
  }

  @Test
  void 삭제된_첨부의_URL이_저장된_본문에_남아있어도_카운트되지_않는다() throws Exception {
    // #757 리뷰 지적: DELETE 는 매핑+file 행을 지우지만 저장된 본문의 URL 텍스트는 그대로 남는다.
    // referencedFileIds 는 그 fileId 를 여전히 파싱해내므로, held 를 "이 페이지에 실제 바인딩된 것" 으로
    // 좁히는 retainAll(bound) 이 없으면 죽은 참조가 카운트를 영원히 부풀려 #757 이 고치려던 "풀 수 없는 409"
    // 가 그대로 재현된다.
    var a = upload(editorId, pageId, pngFile("a.png", 50));
    String bodyWithA = "![a](" + WikiAttachmentResponse.urlOf(pageId, a.fileId()) + ")";
    savePage(editorId, pageId, bodyWithA, 1);

    mvc.perform(
            delete("/api/v1/wiki/pages/" + pageId + "/attachments/" + a.fileId())
                .header("Authorization", "Bearer " + tokenFor(editorId)))
        .andExpect(status().isNoContent());

    // 본문 텍스트는 재저장하지 않아 여전히 a 의 URL 을 담고 있다. 그래도 a 는 더 이상 bound 가 아니므로
    // held 는 비어야 하고, max-per-page(2) 안에서 새 업로드 2개가 모두 성공해야 한다.
    upload(editorId, pageId, pngFile("b.png", 50));
    mvc.perform(
            multipart("/api/v1/wiki/pages/" + pageId + "/attachments")
                .file(pngFile("c.png", 50))
                .header("Authorization", "Bearer " + tokenFor(editorId)))
        .andExpect(status().isCreated());
  }

  @Test
  void promoteReferenced_호출_후_expires_at_이_NULL_이_된다() throws Exception {
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    String body = "![img](" + WikiAttachmentResponse.urlOf(pageId, res.fileId()) + ")";

    attachmentService.syncReferences(pageId, body);

    assertThat(expiresAtOf(res.fileId())).isNull();
  }

  @Test
  void 테넌트_쿼터를_넘으면_업로드가_409() throws Exception {
    // #759 (B): 위키 첨부는 쿼터 집계 밖이었다. 이제 포함되므로 한도를 넘으면 업로드가 거부돼야 한다.
    // 한도를 0 으로 낮춰 "첫 업로드부터 막힌다" 로 고정한다(현재 사용량과 무관하게 결정적).
    long previousQuota =
        dsl.select(TENANT.QUOTA_BYTES).from(TENANT).where(TENANT.ID.eq(1L)).fetchOne(0, Long.class);
    dsl.update(TENANT).set(TENANT.QUOTA_BYTES, 0L).where(TENANT.ID.eq(1L)).execute();
    try {
      mvc.perform(
              multipart("/api/v1/wiki/pages/" + pageId + "/attachments")
                  .file(pngFile("quota.png", 50))
                  .header("Authorization", "Bearer " + tokenFor(editorId)))
          // 첨부 상한도 409 라 상태만 보면 실링을 0 으로 만드는 변이도 초록이 된다 — 사유를 함께 고정한다.
          .andExpect(status().isConflict())
          .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("저장 용량")));
    } finally {
      dsl.update(TENANT).set(TENANT.QUOTA_BYTES, previousQuota).where(TENANT.ID.eq(1L)).execute();
    }
  }

  @Test
  void 쿼터_안이면_업로드가_통과한다() throws Exception {
    // 위 거부 테스트만 있으면 "쿼터 검사가 항상 던진다" 는 변이가 통과한다 — 양성 방향을 함께 고정한다.
    long previousQuota =
        dsl.select(TENANT.QUOTA_BYTES).from(TENANT).where(TENANT.ID.eq(1L)).fetchOne(0, Long.class);
    // 절대값을 쓰면 테넌트1 누적 데이터가 커질 때 깨진다 — 현재 사용량 + 여유로 잡는다.
    dsl.update(TENANT)
        .set(TENANT.QUOTA_BYTES, quotaService.usedBytes() + 1024 * 1024)
        .where(TENANT.ID.eq(1L))
        .execute();
    try {
      mvc.perform(
              multipart("/api/v1/wiki/pages/" + pageId + "/attachments")
                  .file(pngFile("ok.png", 50))
                  .header("Authorization", "Bearer " + tokenFor(editorId)))
          .andExpect(status().isCreated());
    } finally {
      dsl.update(TENANT).set(TENANT.QUOTA_BYTES, previousQuota).where(TENANT.ID.eq(1L)).execute();
    }
  }

  @Test
  void 위키_첨부가_테넌트_사용량에_집계된다() throws Exception {
    // 쿼터 "검사" 가 아니라 "집계" 자체를 고정한다 — sumWikiAttachmentBytes 항을 빼면 여기서 걸린다.
    long before = quotaService.usedBytes();

    var res = upload(editorId, pageId, pngFile("counted.png", 50));

    assertThat(quotaService.usedBytes() - before).isEqualTo(sizeOf(res.fileId()));
  }

  @Test
  void 참조가_사라지면_삭제가_아니라_만료가_재무장된다() throws Exception {
    // #759: promote-only 를 뒤집는다. 즉시 DELETE 는 #751 에서 기각됐으므로(autosave 중간 상태·undo)
    // 강등은 "유예 후 만료" 로만 표시하고 실제 삭제는 정리 스윕에 맡긴다.
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    String bodyWithRef = "![img](" + WikiAttachmentResponse.urlOf(pageId, res.fileId()) + ")";
    attachmentService.syncReferences(pageId, bodyWithRef);
    assertThat(expiresAtOf(res.fileId())).isNull();

    attachmentService.syncReferences(pageId, "참조가 사라진 본문입니다.");

    // 파일 행과 blob 은 그대로 살아 있고, 만료 시각만 미래로 설정된다.
    assertThat(expiresAtOf(res.fileId())).isNotNull().isAfter(OffsetDateTime.now());
    assertThat(demotedAtOf(res.fileId())).isNotNull();
  }

  @Test
  void 유예_안에_참조가_돌아오면_강등이_원상복구된다() throws Exception {
    // #751 이 즉시 삭제를 기각한 바로 그 왕복(잘라내기→붙여넣기, undo, autosave 중간 상태)이
    // 아무 흔적 없이 복구되는지가 이 설계의 핵심이다.
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    String bodyWithRef = "![img](" + WikiAttachmentResponse.urlOf(pageId, res.fileId()) + ")";
    attachmentService.syncReferences(pageId, bodyWithRef);
    attachmentService.syncReferences(pageId, "잠깐 지운 상태(autosave 중간 스냅샷)");
    assertThat(expiresAtOf(res.fileId())).isNotNull();

    attachmentService.syncReferences(pageId, bodyWithRef);

    assertThat(expiresAtOf(res.fileId())).isNull();
    assertThat(demotedAtOf(res.fileId())).isNull();
  }

  @Test
  void 아직_승격된적_없는_임시첨부는_강등이_건드리지_않는다() throws Exception {
    // 업로드 직후라 본문에 실린 적 없는 파일이 강등 후보에 섞여 들어온다. 여기에 유예 만료를 씌우면
    // (1) 24시간 임시 만료가 유예만큼 늘어나고 (2) demoted_at 이 찍혀 상한 계산의 "임시" 집합에서 빠져
    // 업로드 상한이 무력화된다.
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    OffsetDateTime before = expiresAtOf(res.fileId());

    attachmentService.syncReferences(pageId, "이 파일을 참조하지 않는 본문");

    assertThat(expiresAtOf(res.fileId())).isEqualTo(before);
    assertThat(demotedAtOf(res.fileId())).isNull();
  }

  @Test
  void 다른_페이지에_바인딩된_fileId를_본문에_적어도_승격되지_않는다() throws Exception {
    long otherPageId =
        pageService.create(ownerId, spaceId, new CreatePageRequest(null, "다른 페이지")).id();
    var res = upload(editorId, otherPageId, pngFile("a.png", 50));

    // 이 페이지(pageId) 소유가 아닌 fileId 를 본문에 적고 이 페이지 기준으로 promote 시도.
    String body = "![img](" + WikiAttachmentResponse.urlOf(pageId, res.fileId()) + ")";
    attachmentService.syncReferences(pageId, body);

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

    attachmentService.syncReferences(pageId, body);

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
  void 페이지_저장으로_이미지를_지우면_강등된다() throws Exception {
    // 배선 검증 — 강등이 서비스 메서드 직접 호출뿐 아니라 실제 저장 엔드포인트 경로에서도 일어나야 한다(#759).
    var res = upload(editorId, pageId, pngFile("a.png", 50));
    String bodyWithImage = "![img](" + WikiAttachmentResponse.urlOf(pageId, res.fileId()) + ")";
    savePage(editorId, pageId, bodyWithImage, 1);
    assertThat(expiresAtOf(res.fileId())).isNull();

    savePage(editorId, pageId, "이미지를 지운 본문입니다.", 2);

    assertThat(expiresAtOf(res.fileId())).isNotNull();
    assertThat(demotedAtOf(res.fileId())).isNotNull();
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

    attachmentService.syncReferences(pageId, body);

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
