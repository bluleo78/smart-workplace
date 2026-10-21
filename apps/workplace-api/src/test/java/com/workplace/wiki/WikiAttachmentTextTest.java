package com.workplace.wiki;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.dto.ViewImage;
import com.workplace.fileai.outbound.WorkerRenderClient;
import com.workplace.fileai.service.FileExtractionRowWriter;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.exception.WikiAttachmentNotFoundException;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import com.workplace.wiki.repository.WikiAttachmentRepository;
import com.workplace.wiki.service.WikiAttachmentService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 첨부 추출 텍스트(WP-358) — 업로드 시 추출 행 생성, /text 구간 읽기와 권한·소속 가드. 클래스 트랜잭션 롤백으로 공유 DB 를 오염시키지 않는다
 * (AFTER_COMMIT 워커 디스패치도 롤백이라 발화하지 않음).
 *
 * <p>업로드는 매직바이트로 이미지만 받으므로 실제 업로드 경로는 SKIPPED(IMAGE) 만 만든다. PENDING·READY 는 이미지가 아닌 file 행을 직접 시드해
 * 페이지에 바인딩하고 공용 행 작성기로 추출 행을 만들어 검증한다.
 */
@Transactional
class WikiAttachmentTextTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiAttachmentService attachmentService;
  @Autowired WikiAttachmentRepository attachmentRepo;
  @Autowired FileExtractionRowWriter rowWriter;

  /** WP-250: /view 의 워커 렌더 호출 목 — 실제 워커 없이 권한·헤더·본문만 검증한다. */
  @MockitoBean WorkerRenderClient worker;

  /** PNG 매직바이트 + 채움 — ImageSniffer 판정용 16바이트. */
  private static final byte[] PNG = {
    (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0
  };

  private long ownerId;
  private long viewerId;
  private long outsiderId;
  private long pageId;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L); // FilePathBuilder 가 테넌트 컨텍스트로 경로를 만든다
    ownerId = createUser("own");
    viewerId = createUser("vwr");
    outsiderId = createUser("out");
    long spaceId = spaceService.createTeamSpace(ownerId, "추출 테스트 공간").id();
    spaceService.addMember(ownerId, spaceId, viewerId, "VIEWER");
    pageId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "추출 페이지")).id();
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
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
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  /** 이미지가 아닌 file 행을 시드해 페이지에 바인딩한다(추출 행은 만들지 않는다 — 배포 전 첨부와 같은 상태). */
  private long seedBoundPdf() {
    long fileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, "spec.pdf")
            .set(FILE.STORED_NAME, "spec.pdf")
            .set(FILE.MIME_TYPE, "application/pdf")
            .set(FILE.SIZE_BYTES, 10L)
            .set(FILE.CATEGORY, "ATTACHMENT")
            // 경로마다 고유 — /view 캐시({path}.view/)가 이전 실행에서 남아 워커 호출 단언을 흔들지 않게
            .set(FILE.STORAGE_PATH, "tenant-1/wiki/test/" + UUID.randomUUID() + "/spec.pdf")
            .set(FILE.UPLOADED_BY, ownerId)
            .set(FILE.CREATED_AT, OffsetDateTime.now())
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    attachmentRepo.bind(fileId, pageId, ownerId);
    return fileId;
  }

  private void markDone(long fileId, String text) {
    dsl.update(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.STATUS, "DONE")
        .set(FILE_EXTRACTION.EXTRACTED_TEXT, text)
        .set(FILE_EXTRACTION.CHAR_COUNT, text.codePointCount(0, text.length()))
        .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
        .execute();
  }

  private String tokenFor(long userId) {
    return jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L);
  }

  @Test
  void 업로드하면_추출_행이_생기고_이미지는_SKIPPED_IMAGE() {
    var res =
        attachmentService.upload(
            ownerId, pageId, new MockMultipartFile("file", "a.png", "image/png", PNG), null);
    var s = attachmentService.readText(viewerId, pageId, res.fileId(), 0, 100, null);
    assertThat(s.status()).isEqualTo("SKIPPED");
    assertThat(s.reasonCode()).isEqualTo("IMAGE");
    assertThat(s.text()).isNull();
  }

  @Test
  void 추출_대기_중이면_PENDING() {
    long fileId = seedBoundPdf();
    rowWriter.write(fileId, 1L, "application/pdf", ExtractionProfile.TEXT_ONLY);
    assertThat(attachmentService.readText(viewerId, pageId, fileId, 0, 10, null).status())
        .isEqualTo("PENDING");
  }

  @Test
  void 추출이_끝나면_구간_읽기() {
    long fileId = seedBoundPdf();
    rowWriter.write(fileId, 1L, "application/pdf", ExtractionProfile.TEXT_ONLY);
    markDone(fileId, "가나다라마");
    var s = attachmentService.readText(viewerId, pageId, fileId, 1, 2, null);
    assertThat(s.status()).isEqualTo("READY");
    assertThat(s.text()).isEqualTo("나다");
    assertThat(s.totalChars()).isEqualTo(5);
    assertThat(s.nextOffset()).isEqualTo(3);
  }

  @Test
  void 추출_행이_없는_기존_첨부는_NONE() {
    long fileId = seedBoundPdf();
    assertThat(attachmentService.readText(viewerId, pageId, fileId, 0, 10, null).status())
        .isEqualTo("NONE");
  }

  @Test
  void 공간_비멤버는_존재_은닉_404_다른_페이지_파일도_404() {
    long fileId = seedBoundPdf();
    assertThatThrownBy(() -> attachmentService.readText(outsiderId, pageId, fileId, 0, 10, null))
        .isInstanceOf(WikiSpaceNotFoundException.class);
    assertThatThrownBy(
            () -> attachmentService.readText(viewerId, pageId, 999_999_999L, 0, 10, null))
        .isInstanceOf(WikiAttachmentNotFoundException.class);
  }

  @Test
  void 엔드포인트는_ExtractedTextSlice_를_돌려주고_비멤버는_404() throws Exception {
    long fileId = seedBoundPdf();
    rowWriter.write(fileId, 1L, "application/pdf", ExtractionProfile.TEXT_ONLY);
    markDone(fileId, "hello world");
    String url = "/api/v1/wiki/pages/" + pageId + "/attachments/" + fileId + "/text";
    mvc.perform(
            get(url)
                .param("offset", "6")
                .param("limit", "100")
                .header("Authorization", "Bearer " + tokenFor(viewerId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.fileId").value(fileId))
        .andExpect(jsonPath("$.status").value("READY"))
        .andExpect(jsonPath("$.text").value("world"))
        .andExpect(jsonPath("$.nextOffset").doesNotExist());
    mvc.perform(get(url).header("Authorization", "Bearer " + tokenFor(outsiderId)))
        .andExpect(status().isNotFound());
  }

  // ---- WP-250: GET .../attachments/{fileId}/view — 첨부 PDF 쪽·이미지를 모델 입력용 이미지로 ----

  private static final byte[] VIEW_PNG = {(byte) 0x89, 'P', 'N', 'G', 9, 9, 9};

  @Test
  void view_는_권한_있는_사용자에게_이미지와_쪽수_헤더를_돌려준다() throws Exception {
    long fileId = seedBoundPdf();
    when(worker.render(anyString(), eq("application/pdf"), eq(1), anyInt()))
        .thenReturn(new ViewImage(VIEW_PNG, "image/png", 3));
    mvc.perform(
            get("/api/v1/wiki/pages/" + pageId + "/attachments/" + fileId + "/view")
                .param("page", "1")
                .header("Authorization", "Bearer " + tokenFor(viewerId)))
        .andExpect(status().isOk())
        .andExpect(header().string("Content-Type", "image/png"))
        .andExpect(header().string("X-Page-Count", "3"))
        .andExpect(header().string("Cache-Control", "max-age=300, private"))
        .andExpect(content().bytes(VIEW_PNG));
  }

  @Test
  void view_는_공간_비멤버를_404_로_막고_워커를_부르지_않는다() throws Exception {
    long fileId = seedBoundPdf();
    mvc.perform(
            get("/api/v1/wiki/pages/" + pageId + "/attachments/" + fileId + "/view")
                .param("page", "1")
                .header("Authorization", "Bearer " + tokenFor(outsiderId)))
        .andExpect(status().isNotFound());
    verifyNoInteractions(worker);
  }

  @Test
  void view_는_이_페이지에_없는_fileId_를_404_로_막는다() throws Exception {
    mvc.perform(
            get("/api/v1/wiki/pages/" + pageId + "/attachments/999999999/view")
                .param("page", "1")
                .header("Authorization", "Bearer " + tokenFor(viewerId)))
        .andExpect(status().isNotFound());
    verifyNoInteractions(worker);
  }
}
