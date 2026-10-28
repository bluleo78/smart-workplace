package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.file.storage.FileStore;
import com.workplace.fileai.dto.ViewImage;
import com.workplace.fileai.exception.AttachmentViewException;
import com.workplace.fileai.outbound.WorkerRenderClient;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.MailTestPorts;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository.AttachmentDownloadContext;
import com.workplace.mail.service.MailAttachmentService.AttachmentDownload;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메일 첨부 보기(WP-388) — {@code GET /mail/attachments/{id}/view} 가 요청마다 원본을 받아 워커 본문({@code
 * /render/bytes})으로 그리게 하고, 저장소·DB 에 아무것도 남기지 않는지(파일·file 행·".view" 캐시 없음) 검증한다.
 *
 * <p>바이트 확보({@link MailAttachmentService})와 워커({@link WorkerRenderClient})만 목이다 — FileStore 는 실제
 * 빈이라 요청 전후 저장소 파일을 비교한다. 클래스 트랜잭션 롤백으로 공유 DB 를 오염시키지 않는다.
 */
@Transactional
class MailAttachmentViewTest extends ExternalClientMockedTestBase {

  private static final long T = 1L;
  private static final byte[] PDF = "%PDF-1.4 view test".getBytes();
  private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 7, 7, 7, 7};

  /** 공통 spy(IntegrationTestBase) — 원본 내려받기(download)만 스텁해 IMAP 에 붙지 않는다. */
  @Autowired MailAttachmentService attachmentService;

  @Autowired WorkerRenderClient worker;

  @Autowired ContentAttachmentRepository contentAttachmentRepo;
  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired FileStore fileStore;

  private long userA;
  private long userB;
  private long contentId;
  private long accA;
  private long fldA;
  private long msgA;
  private String msgId;
  private int ordinal;

  /** 마지막으로 단 첨부의 manifest(content_attachment) id — 추출 사본 링크용. */
  private long lastCaId;

  @BeforeEach
  void setUp() {
    TenantContext.set(T);
    userA = TestFixtures.createHuman(dsl);
    userB = TestFixtures.createHuman(dsl);
    long nano = System.nanoTime();
    accA = account(userA, "va-" + nano);
    fldA = folder(accA);
    msgId = "<view-" + nano + "@test.local>";
    contentId =
        dsl.insertInto(EMAIL_CONTENT)
            .set(EMAIL_CONTENT.MESSAGE_ID, msgId)
            .set(EMAIL_CONTENT.THREAD_ID, msgId)
            .set(EMAIL_CONTENT.TENANT_ID, T)
            .returning(EMAIL_CONTENT.ID)
            .fetchOne()
            .getId();
    msgA = message(accA, fldA, 100L);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void PDF_쪽을_그리고_디스크_DB_에_아무것도_남기지_않는다() throws Exception {
    long att = attachment("spec.pdf", "application/pdf", 100L);
    givenDownload(PDF, "spec.pdf", "application/pdf");
    recordRender(new ViewImage(PNG, "image/png", 4));
    int filesBefore = fileRowCount();
    Set<Path> storeBefore = storeFiles();

    mvc.perform(get(viewUrl(att) + "?page=2").header("Authorization", bearer(userA)))
        .andExpect(status().isOk())
        .andExpect(header().string("Content-Type", "image/png"))
        .andExpect(header().string(ViewImage.PAGE_COUNT_HEADER, "4"))
        .andExpect(content().bytes(PNG));

    // 원본은 워커 본문으로만 간다 — 저장소 경로 렌더(/render)는 쓰지 않고, 저장소에 파일(임시·".view" 캐시)이 생기지 않는다.
    verify(worker).renderBytes(eq(PDF), eq("application/pdf"), eq(2), eq(1568));
    verify(worker, never()).render(anyString(), anyString(), any(), anyInt());
    assertThat(storeFiles()).isEqualTo(storeBefore);
    assertThat(fileRowCount()).isEqualTo(filesBefore);
  }

  @Test
  void 워커가_거절하면_그_사유를_전한다() throws Exception {
    long att = attachment("broken.pdf", "application/pdf", 100L);
    givenDownload(PDF, "broken.pdf", "application/pdf");
    recordRenderThrowing(new AttachmentViewException("UNREADABLE"));

    mvc.perform(get(viewUrl(att) + "?page=1").header("Authorization", bearer(userA)))
        .andExpect(status().isUnprocessableEntity())
        .andExpect(
            jsonPath("$.message").value(new AttachmentViewException("UNREADABLE").getMessage()));
  }

  @Test
  void 범위_밖_쪽은_워커가_알려준_쪽수와_함께_400() throws Exception {
    long att = attachment("spec.pdf", "application/pdf", 100L);
    givenDownload(PDF, "spec.pdf", "application/pdf");
    recordRenderThrowing(new AttachmentViewException("PAGE_OUT_OF_RANGE", 3));

    mvc.perform(get(viewUrl(att) + "?page=9").header("Authorization", bearer(userA)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("이 PDF 는 3쪽입니다. 1~3 사이 페이지를 지정하세요."));
  }

  @Test
  void 타인_첨부는_404_원본도_워커도_부르지_않는다() throws Exception {
    long att = attachment("spec.pdf", "application/pdf", 100L);

    mvc.perform(get(viewUrl(att) + "?page=1").header("Authorization", bearer(userB)))
        .andExpect(status().isNotFound());

    verifyNoInteractions(attachmentService, worker);
  }

  @Test
  void 형식_page_크기가_맞지_않으면_원본을_가져오기_전에_거절한다() throws Exception {
    long docx =
        attachment(
            "a.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            100L);
    long svg = attachment("a.svg", "image/svg+xml", 100L);
    long png = attachment("a.png", "image/png", 100L);
    long pdf = attachment("a.pdf", "application/pdf", 100L);
    // manifest 크기(base64 기준 여유 4/3)를 넘는 첨부 — 받지 않고 413.
    long huge = attachment("huge.pdf", "application/pdf", 40L * 1024 * 1024);

    mvc.perform(get(viewUrl(docx)).header("Authorization", bearer(userA)))
        .andExpect(status().isUnsupportedMediaType());
    mvc.perform(get(viewUrl(svg)).header("Authorization", bearer(userA)))
        .andExpect(status().isUnsupportedMediaType());
    mvc.perform(get(viewUrl(png) + "?page=1").header("Authorization", bearer(userA)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("page 는 PDF 에만 쓸 수 있습니다."));
    mvc.perform(get(viewUrl(pdf)).header("Authorization", bearer(userA)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("PDF 는 page 로 볼 페이지를 지정해야 합니다."));
    mvc.perform(get(viewUrl(huge) + "?page=1").header("Authorization", bearer(userA)))
        .andExpect(status().isPayloadTooLarge());

    verifyNoInteractions(attachmentService, worker);
  }

  @Test
  void 받은_원본이_25MB_를_넘으면_워커_없이_413() throws Exception {
    // manifest 크기를 모르는(작게 기록된) 경우 — 받은 바이트로 다시 판정한다.
    long att = attachment("big.pdf", "application/pdf", 100L);
    givenDownload(new byte[25 * 1024 * 1024 + 1], "big.pdf", "application/pdf");

    mvc.perform(get(viewUrl(att) + "?page=1").header("Authorization", bearer(userA)))
        .andExpect(status().isPayloadTooLarge());

    verifyNoInteractions(worker);
  }

  @Test
  void octet_stream_HEIC_는_파일명으로_보정해_page_없이_변환본을_그린다() throws Exception {
    long att = attachment("photo.heic", "application/octet-stream", 100L);
    givenDownload(PNG, "photo.heic", "application/octet-stream");
    recordRender(new ViewImage(PNG, "image/jpeg", null));

    mvc.perform(get(viewUrl(att)).header("Authorization", bearer(userA)))
        .andExpect(status().isOk())
        .andExpect(header().string("Content-Type", "image/jpeg"))
        .andExpect(header().doesNotExist(ViewImage.PAGE_COUNT_HEADER));

    verify(worker).renderBytes(eq(PNG), eq("image/heic"), isNull(), anyInt());
  }

  @Test
  void 추출_사본이_알려준_쪽수를_넘는_쪽은_원본을_받기_전에_PAGE_OUT_OF_RANGE() throws Exception {
    long att = attachment("spec.pdf", "application/pdf", 100L);
    // /text 가 만든 추출 사본 — 바이너리는 추출 직후 지워져도 file·추출 행(page_count)은 만료까지 남는다.
    long extractFileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, "spec.pdf")
            .set(FILE.STORED_NAME, "spec.pdf")
            .set(FILE.MIME_TYPE, "application/pdf")
            .set(FILE.SIZE_BYTES, 100L)
            .set(FILE.STORAGE_PATH, "tenant-1/mail-extract/released-" + System.nanoTime())
            .set(FILE.UPLOADED_BY, userB)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.FILE_ID, extractFileId)
        .set(FILE_EXTRACTION.STATUS, "DONE")
        .set(FILE_EXTRACTION.PAGE_COUNT, 3)
        .set(FILE_EXTRACTION.PROFILE, "TEXT_ONLY")
        .set(FILE_EXTRACTION.TENANT_ID, T)
        .execute();
    contentAttachmentRepo.linkExtractFile(lastCaId, extractFileId);

    mvc.perform(get(viewUrl(att) + "?page=4").header("Authorization", bearer(userA)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("이 PDF 는 3쪽입니다. 1~3 사이 페이지를 지정하세요."));

    verifyNoInteractions(attachmentService, worker);
  }

  @Test
  void 크기_사전_차단은_Graph_는_실제_25MB_IMAP_은_base64_여유를_둔다() throws Exception {
    // 26MB: IMAP size(base64 기준 ~4/3)로는 실제 ~19.5MB 라 받아서 판정하고, Graph size(실제 바이트)로는 바로 413.
    long size = 26L * 1024 * 1024;
    long imapAtt = attachment("imap.pdf", "application/pdf", size);
    givenDownload(PDF, "imap.pdf", "application/pdf");
    recordRender(new ViewImage(PNG, "image/png", 1));
    mvc.perform(get(viewUrl(imapAtt) + "?page=1").header("Authorization", bearer(userA)))
        .andExpect(status().isOk());

    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .where(EMAIL_ACCOUNT.ID.eq(accA))
        .execute();
    long graphAtt = attachment("graph.pdf", "application/pdf", size);
    mvc.perform(get(viewUrl(graphAtt) + "?page=1").header("Authorization", bearer(userA)))
        .andExpect(status().isPayloadTooLarge());
    verify(attachmentService, times(1)).download(anyLong(), any(AttachmentDownloadContext.class));
    // 보기는 ① 에서 확인한 컨텍스트를 넘긴다 — id 로 소유를 다시 조회하는 진입점은 쓰지 않는다.
    verify(attachmentService, never()).download(anyLong(), anyLong());
  }

  /**
   * HTTP 계층 — MCP rest-client 가 부르는 경로 그대로({@code /api/v1/mail/attachments/{id}/view?page=N},
   * viewUrl). page 쿼리가 서비스까지 정수로 묶이고, 정수가 아니면 서비스·원본·워커를 부르지 않고 400 이다.
   */
  @Test
  void page_쿼리는_정수로_묶이고_정수가_아니면_400() throws Exception {
    long att = attachment("spec.pdf", "application/pdf", 100L);
    givenDownload(PDF, "spec.pdf", "application/pdf");
    recordRender(new ViewImage(PNG, "image/png", 5));

    mvc.perform(
            get("/api/v1/mail/attachments/" + att + "/view?page=5")
                .header("Authorization", bearer(userA)))
        .andExpect(status().isOk())
        .andExpect(content().bytes(PNG));
    verify(worker).renderBytes(any(), eq("application/pdf"), eq(5), anyInt());

    mvc.perform(get(viewUrl(att) + "?page=abc").header("Authorization", bearer(userA)))
        .andExpect(status().isBadRequest());
    verify(attachmentService, times(1)).download(anyLong(), any(AttachmentDownloadContext.class));
  }

  // ── 픽스처 ──

  private void givenDownload(byte[] data, String filename, String contentType) {
    willReturn(new AttachmentDownload(data, filename, contentType))
        .given(attachmentService)
        .download(anyLong(), any(AttachmentDownloadContext.class));
  }

  /** 워커가 result 를 돌려주게 한다. */
  private void recordRender(ViewImage result) {
    given(worker.renderBytes(any(), anyString(), any(), anyInt())).willReturn(result);
  }

  /** 워커가 error 를 던지게 한다. */
  private void recordRenderThrowing(AttachmentViewException error) {
    given(worker.renderBytes(any(), anyString(), any(), anyInt())).willThrow(error);
  }

  /**
   * 저장소 루트 아래 모든 파일(없으면 빈 집합) — 요청 전후를 비교해 아무것도 쓰지 않았는지 본다. 테스트 fork 마다 루트가 따로라 다른 fork 에 흔들리지 않는다.
   */
  private Set<Path> storeFiles() throws Exception {
    Path root = fileStore.rootDir();
    if (!Files.exists(root)) return Set.of();
    try (Stream<Path> s = Files.walk(root)) {
      return s.filter(Files::isRegularFile).collect(Collectors.toSet());
    }
  }

  /** 이 요청이 만들 수 있는 file 행 수 — 다른 테스트 fork 가 커밋한 행에 흔들리지 않게 요청자(userA) 업로드로 좁힌다. */
  private int fileRowCount() {
    return dsl.fetchCount(FILE, FILE.UPLOADED_BY.eq(userA));
  }

  private static String viewUrl(long attachmentId) {
    return "/api/v1/mail/attachments/" + attachmentId + "/view";
  }

  private String bearer(long uid) {
    // WP-420: tenant 토큰은 그 테넌트 ACTIVE 멤버일 때만 인증된다 — 실제 워크스페이스 선택과 같은 전제를 맞춘다.
    TestFixtures.ensureActiveMember(dsl, uid, T);
    return "Bearer " + jwtTokenProvider.generateAccessToken(uid, "user-" + uid, T);
  }

  private long account(long userId, String tag) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, tag + "@test.local")
        .set(EMAIL_ACCOUNT.IMAP_HOST, "127.0.0.1")
        .set(EMAIL_ACCOUNT.IMAP_PORT, MailTestPorts.IMAP)
        .set(EMAIL_ACCOUNT.IMAP_SECURITY, "NONE")
        .set(EMAIL_ACCOUNT.IMAP_USERNAME, tag + "@test.local")
        .set(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD, "x")
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .set(EMAIL_ACCOUNT.TENANT_ID, T)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  private long folder(long accountId) {
    return dsl.insertInto(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
        .set(EMAIL_FOLDER.NAME, "INBOX")
        .set(EMAIL_FOLDER.TENANT_ID, T)
        .returning(EMAIL_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  private long message(long accountId, long folderId, long uid) {
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.MESSAGE_ID, msgId)
        .set(EMAIL_MESSAGE.THREAD_ID, msgId)
        .set(EMAIL_MESSAGE.IMAP_UID, uid)
        .set(EMAIL_MESSAGE.SEEN, false)
        .set(EMAIL_MESSAGE.HAS_ATTACHMENT, true)
        .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
        .set(EMAIL_MESSAGE.TENANT_ID, T)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /** userA 메일에 첨부(manifest 포함) 하나를 단다 — 순번은 호출마다 늘린다(메일당 순번 유일). */
  private long attachment(String filename, String contentType, long sizeBytes) {
    int ord = ordinal++;
    long caId =
        contentAttachmentRepo.findOrCreate(contentId, ord, filename, contentType, sizeBytes, null);
    lastCaId = caId;
    return dsl.insertInto(EMAIL_ATTACHMENT)
        .set(EMAIL_ATTACHMENT.MESSAGE_ID, msgA)
        .set(EMAIL_ATTACHMENT.ORDINAL, ord)
        .set(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID, caId)
        .set(EMAIL_ATTACHMENT.TENANT_ID, T)
        .returning(EMAIL_ATTACHMENT.ID)
        .fetchOne()
        .getId();
  }
}
