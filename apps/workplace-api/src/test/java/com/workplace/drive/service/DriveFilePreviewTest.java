package com.workplace.drive.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FILE_VERSION;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_PREVIEW;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.file.service.FileCleanupService;
import com.workplace.file.storage.FileStore;
import com.workplace.filepreview.PreviewTypes;
import com.workplace.filepreview.outbound.ConvertOutcome;
import com.workplace.filepreview.outbound.ConverterClient;
import com.workplace.filepreview.outbound.ConverterProperties;
import com.workplace.filepreview.repository.FilePreviewRepository;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 드라이브 문서 미리보기 엔드포인트·업로드 시 백그라운드 변환(WP-431) 통합 테스트.
 *
 * <p>실제 multipart 업로드 → 커밋 후 리스너 → 백그라운드 실행기 → 변환(목) → {@code GET /drive/files/{id}/preview} 까지
 * 종단으로 본다. 변환은 실행기 스레드에서 돌므로 클래스 레벨 {@code @Transactional} 없이 기본 테넌트(1)가 아닌 fixture 테넌트에
 * 커밋하고(WP-417 — 세션 기본 GUC=1 이 비동기 GUC 누락을 가리지 않게), 정리는 {@code @AfterEach} 에서 자기 스페이스 행만 지운다.
 */
@TestPropertySource(properties = "workplace.converter.enabled=true")
class DriveFilePreviewTest extends ExternalClientMockedTestBase {

  private static final String FIXTURE_TENANT_SLUG = "drive-preview-fixture-tenant";
  private static final String HWP = "application/x-hwp";

  @Autowired DSLContext dsl;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper objectMapper;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired FilePreviewRepository previewRepo;
  @Autowired ConverterProperties props;
  @Autowired FileStore fileStore;
  @Autowired DriveFileService fileService;
  @Autowired DriveTrashService trashService;
  @Autowired FileCleanupService fileCleanupService;

  @Autowired ConverterClient converter;

  private Long tid2;
  private Long memberId;
  private Long outsiderId;
  private Long spaceId;
  // 직접 시드한 core file(드라이브 바인딩 없이 정리 대상) — 업로드분은 스페이스 기준으로 찾는다.
  private final List<String> seededPaths = new ArrayList<>();

  @BeforeEach
  void seed() {
    String suffix = suffix();
    inTenantTx(
        () -> {
          memberId = insertUser("pv_m_" + suffix);
          outsiderId = insertUser("pv_o_" + suffix);
          spaceId =
              dsl.insertInto(DRIVE_SPACE)
                  .set(DRIVE_SPACE.TYPE, "TEAM")
                  .set(DRIVE_SPACE.NAME, "미리보기_" + suffix)
                  .set(DRIVE_SPACE.OWNER_ID, memberId)
                  .returning(DRIVE_SPACE.ID)
                  .fetchOne()
                  .getId();
          dsl.insertInto(DRIVE_SPACE_MEMBER)
              .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
              .set(DRIVE_SPACE_MEMBER.USER_ID, memberId)
              .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
              .execute();
          TestFixtures.ensureActiveMember(dsl, memberId, tid2);
          TestFixtures.ensureActiveMember(dsl, outsiderId, tid2);
          return null;
        });
    // 기본 변환 목: 원본 바이트를 감싼 PDF — 버전마다 다른 결과가 나와 "새 버전 PDF" 를 구분할 수 있다.
    when(converter.convertPdf(any(), anyString()))
        .thenAnswer(inv -> new ConvertOutcome.Success(pdfOf(inv.getArgument(0)), 1));
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (tid2 == null) {
      return;
    }
    List<String> paths = new ArrayList<>(seededPaths);
    inTenantTx(
        () -> {
          // 이 스페이스의 모든 버전 blob + 현재 blob(직접 시드분 포함)
          List<Long> driveFileIds =
              dsl.select(DRIVE_FILE.ID)
                  .from(DRIVE_FILE)
                  .where(DRIVE_FILE.SPACE_ID.eq(spaceId))
                  .fetch(DRIVE_FILE.ID);
          List<Long> fileIds =
              new ArrayList<>(
                  dsl.select(DRIVE_FILE_VERSION.FILE_ID)
                      .from(DRIVE_FILE_VERSION)
                      .where(DRIVE_FILE_VERSION.DRIVE_FILE_ID.in(driveFileIds))
                      .fetch(DRIVE_FILE_VERSION.FILE_ID));
          fileIds.addAll(
              dsl.select(DRIVE_FILE.FILE_ID)
                  .from(DRIVE_FILE)
                  .where(DRIVE_FILE.SPACE_ID.eq(spaceId))
                  .fetch(DRIVE_FILE.FILE_ID));
          paths.addAll(
              dsl.select(FILE.STORAGE_PATH)
                  .from(FILE)
                  .where(FILE.ID.in(fileIds))
                  .fetch(FILE.STORAGE_PATH));
          // FK 순서: DRIVE_FILE(→ 버전 CASCADE) → FILE(→ file_preview·file_extraction CASCADE) → 스페이스 →
          // 사용자
          // 감사 로그는 user FK 가 있다 — 영구삭제로 drive_file 이 사라진 경우까지 사용자 기준으로 지운다.
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(memberId, outsiderId)).execute();
          dsl.deleteFrom(DRIVE_FILE).where(DRIVE_FILE.SPACE_ID.eq(spaceId)).execute();
          dsl.deleteFrom(FILE_PREVIEW).where(FILE_PREVIEW.FILE_ID.in(fileIds)).execute();
          dsl.deleteFrom(FILE).where(FILE.ID.in(fileIds)).execute();
          dsl.deleteFrom(DRIVE_SPACE_MEMBER)
              .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
              .execute();
          dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(memberId, outsiderId)).execute();
          return null;
        });
    for (String p : paths) {
      fileStore.deleteWithDerived(p, null);
    }
    seededPaths.clear();
  }

  @Test
  void HWP_를_올리면_백그라운드로_변환되고_열면_PDF_200() throws Exception {
    long driveFileId = upload("보고서.hwp", HWP, "v1");
    long coreId = coreFileId(driveFileId);

    awaitStatus(coreId, "READY");

    byte[] expected = pdfBytes("v1");
    preview(driveFileId, null)
        .andExpect(status().isOk())
        .andExpect(header().string("Content-Type", "application/pdf"))
        .andExpect(header().longValue("Content-Length", expected.length))
        .andExpect(header().string("Cache-Control", "private, no-cache"))
        .andExpect(content().bytes(expected));
  }

  @Test
  void PDF_200_은_ETag_와_Last_Modified_를_달고_같은_ETag_면_304() throws Exception {
    long driveFileId = upload("보고서.hwp", HWP, "v1");
    long coreId = coreFileId(driveFileId);
    awaitStatus(coreId, "READY");

    MvcResult first =
        preview(driveFileId, null)
            .andExpect(status().isOk())
            .andExpect(header().exists("Last-Modified"))
            .andReturn();
    String etag = first.getResponse().getHeader("ETag");
    assertThat(etag)
        .startsWith("\"" + coreId + "-" + props.preview().engineVersion() + "-")
        .endsWith("\"");

    mvc.perform(
            get("/api/v1/drive/files/{id}/preview", driveFileId)
                .header("Authorization", tokenFor(memberId))
                .header("If-None-Match", etag))
        .andExpect(status().isNotModified())
        .andExpect(content().bytes(new byte[0]));
    TenantContext.clear();

    // 다른 ETag 면 다시 PDF 를 준다.
    mvc.perform(
            get("/api/v1/drive/files/{id}/preview", driveFileId)
                .header("Authorization", tokenFor(memberId))
                .header("If-None-Match", "\"stale\""))
        .andExpect(status().isOk())
        .andExpect(content().bytes(pdfBytes("v1")));
    TenantContext.clear();
  }

  @Test
  void 범용_형식으로_올린_HWP_도_파일명으로_골라_백그라운드_변환한다() throws Exception {
    // 브라우저가 .hwp 를 모르면 application/octet-stream 으로 보낸다 — 파일명 확장자로 대상 형식을 골라야 한다.
    long driveFileId = upload("보고서.hwp", "application/octet-stream", "v1");

    awaitStatus(coreFileId(driveFileId), "READY");
  }

  @Test
  void 변환_중이면_202_CONVERTING() throws Exception {
    CountDownLatch gate = new CountDownLatch(1);
    // 기본 목(thenAnswer)이 있어 when(...) 재스터빙은 그 답을 실행하므로 do- 형식으로 덮는다.
    doAnswer(
            inv -> {
              gate.await(10, TimeUnit.SECONDS);
              return new ConvertOutcome.Success(pdfOf(inv.getArgument(0)), 1);
            })
        .when(converter)
        .convertPdf(any(), anyString());
    long driveFileId = upload("보고서.hwp", HWP, "v1");
    long coreId = coreFileId(driveFileId);
    try {
      preview(driveFileId, null)
          .andExpect(status().isAccepted())
          .andExpect(jsonPath("$.status").value("CONVERTING"))
          // 실패가 아닌 응답에는 code·transient 를 싣지 않는다.
          .andExpect(jsonPath("$.code").doesNotExist())
          .andExpect(jsonPath("$.transient").doesNotExist());
    } finally {
      gate.countDown();
    }
    awaitStatus(coreId, "READY");
  }

  @Test
  void 영구_실패면_422_와_code_transient_false() throws Exception {
    doReturn(new ConvertOutcome.Failure("TOO_MANY_PAGES", false))
        .when(converter)
        .convertPdf(any(), anyString());
    long driveFileId = upload("보고서.hwp", HWP, "v1");
    awaitStatus(coreFileId(driveFileId), "FAILED");

    preview(driveFileId, null)
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.status").value("FAILED"))
        .andExpect(jsonPath("$.code").value("TOO_MANY_PAGES"))
        .andExpect(jsonPath("$.transient").value(false));
  }

  @Test
  void 일시_실패면_폴링은_422_transient_true() throws Exception {
    doReturn(new ConvertOutcome.Failure("BUSY", true))
        .when(converter)
        .convertPdf(any(), anyString());
    long driveFileId = upload("보고서.hwp", HWP, "v1");
    long coreId = coreFileId(driveFileId);
    awaitStatus(coreId, "FAILED");

    // 폴링(start 없음)은 FAILED 를 다시 선점하지 않는다.
    preview(driveFileId, null)
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.status").value("FAILED"))
        .andExpect(jsonPath("$.code").value("BUSY"))
        .andExpect(jsonPath("$.transient").value(true));

    // 시도의 첫 요청(start=true)은 다시 선점한다.
    preview(driveFileId, true)
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.status").value("CONVERTING"));
    awaitStatus(coreId, "FAILED");
  }

  @Test
  void 대상_형식이_아니면_404() throws Exception {
    long driveFileId = upload("메모.txt", "text/plain", "hello");

    // 웹이 다른 404(휴지통·권한·원본 유실)와 구분하도록 NOT_APPLICABLE 본문을 단다.
    preview(driveFileId, true)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.status").value("NOT_APPLICABLE"))
        .andExpect(jsonPath("$.code").doesNotExist());
    verifyNoInteractions(converter);
  }

  @Test
  void 비멤버는_존재_은닉으로_거부되고_변환하지_않는다() throws Exception {
    // 업로드는 백그라운드 변환을 부르므로, 변환 호출 0 을 보려고 드라이브 행을 직접 시드한다.
    long driveFileId = seedDriveFile("보고서.hwp", HWP);

    // /view 비멤버와 같은 상태 코드(404 — 스페이스 존재 은닉).
    try {
      mvc.perform(
              get("/api/v1/drive/files/{id}/preview", driveFileId)
                  .param("start", "true")
                  .header("Authorization", tokenFor(outsiderId)))
          .andExpect(status().isNotFound())
          // 예외 봉투(ErrorResponse.status=404 숫자) — 웹이 NOT_APPLICABLE 와 구분해 오류 화면으로 보인다.
          .andExpect(jsonPath("$.status").value(404));
    } finally {
      TenantContext.clear();
    }
    verifyNoInteractions(converter);
  }

  @Test
  void 새_버전을_올리면_새_버전이_따로_변환된다() throws Exception {
    long driveFileId = upload("보고서.hwp", HWP, "v1");
    long v1 = coreFileId(driveFileId);
    awaitStatus(v1, "READY");

    long again = upload("보고서.hwp", HWP, "v2");
    assertThat(again).isEqualTo(driveFileId);
    long v2 = coreFileId(driveFileId);
    assertThat(v2).isNotEqualTo(v1);
    awaitStatus(v2, "READY");

    assertThat(row(v1).status()).isEqualTo("READY");
    preview(driveFileId, null)
        .andExpect(status().isOk())
        .andExpect(content().bytes(pdfBytes("v2")));
  }

  @Test
  void 원본을_영구_삭제하면_preview_pdf_와_행이_함께_지워진다() throws Exception {
    long driveFileId = upload("보고서.hwp", HWP, "v1");
    long coreId = coreFileId(driveFileId);
    awaitStatus(coreId, "READY");
    Path pdf = fileStore.resolve(PreviewTypes.previewPath(storagePathOf(coreId)));
    assertThat(Files.exists(pdf)).isTrue();

    // DriveVersionPurgeTest 와 같은 정리 경로: 휴지통 → 보존 기한 지난 것으로 영구삭제(blob 만료) → 만료 파일 정리.
    TenantContext.set(tid2);
    try {
      fileService.delete(memberId, driveFileId);
      trashService.purgeExpired(OffsetDateTime.now(ZoneOffset.UTC).plusDays(1));
    } finally {
      TenantContext.clear();
    }
    fileCleanupService.cleanupExpiredFiles();

    assertThat(Files.exists(pdf)).isFalse();
    assertThat(row(coreId)).isNull();
  }

  @Test
  void 변환_작업이_예외를_던져도_업로드는_성공하고_행은_일시_실패로_남는다() throws Exception {
    doThrow(new RuntimeException("boom")).when(converter).convertPdf(any(), anyString());
    long driveFileId = upload("보고서.hwp", HWP, "v1");
    long coreId = coreFileId(driveFileId);

    awaitStatus(coreId, "FAILED");
    FilePreviewRepository.Row r = row(coreId);
    assertThat(r.failureCode()).isEqualTo("UNAVAILABLE");
    assertThat(r.failureTransient()).isTrue();
  }

  // ───────────── 헬퍼 ─────────────

  /** 멤버 토큰으로 실제 multipart 업로드(201)를 하고 drive_file.id 를 돌려준다. */
  private long upload(String name, String contentType, String body) throws Exception {
    MockMultipartFile file =
        new MockMultipartFile("file", name, contentType, body.getBytes(StandardCharsets.UTF_8));
    try {
      String json =
          mvc.perform(
                  multipart("/api/v1/drive/spaces/{id}/files", spaceId)
                      .file(file)
                      .header("Authorization", tokenFor(memberId)))
              .andExpect(status().isCreated())
              .andReturn()
              .getResponse()
              .getContentAsString(StandardCharsets.UTF_8);
      return objectMapper.readTree(json).get("id").asLong();
    } finally {
      TenantContext.clear(); // 요청 필터가 남긴 테스트 스레드 컨텍스트를 비운다
    }
  }

  private ResultActions preview(long driveFileId, Boolean start) throws Exception {
    var req =
        get("/api/v1/drive/files/{id}/preview", driveFileId)
            .header("Authorization", tokenFor(memberId));
    if (start != null) {
      req = req.param("start", String.valueOf(start));
    }
    try {
      return mvc.perform(req);
    } finally {
      TenantContext.clear();
    }
  }

  private String tokenFor(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "u" + userId, tid2);
  }

  /** 드라이브 파일의 현재 버전 core file.id. */
  private long coreFileId(long driveFileId) {
    return inTenantTx(
        () ->
            dsl.select(DRIVE_FILE.FILE_ID)
                .from(DRIVE_FILE)
                .where(DRIVE_FILE.ID.eq(driveFileId))
                .fetchOne(DRIVE_FILE.FILE_ID));
  }

  private String storagePathOf(long fileId) {
    return inTenantTx(
        () ->
            dsl.select(FILE.STORAGE_PATH).from(FILE).where(FILE.ID.eq(fileId)).fetchOne().value1());
  }

  /** 업로드 없이(리스너를 거치지 않고) 원본 blob + file + drive_file 을 직접 커밋한다. */
  private long seedDriveFile(String name, String mime) {
    String suffix = suffix();
    String storagePath = "wp431-drive-preview/" + suffix + "/" + suffix + ".bin";
    fileStore.storeBytes(storagePath, "원본".getBytes(StandardCharsets.UTF_8));
    seededPaths.add(storagePath);
    return inTenantTx(
        () -> {
          long fileId =
              dsl.insertInto(FILE)
                  .set(FILE.ORIGINAL_NAME, name)
                  .set(FILE.STORED_NAME, "stored_" + suffix)
                  .set(FILE.MIME_TYPE, mime)
                  .set(FILE.SIZE_BYTES, 6L)
                  .set(FILE.STORAGE_PATH, storagePath)
                  .set(FILE.UPLOADED_BY, memberId)
                  .returning(FILE.ID)
                  .fetchOne()
                  .getId();
          return dsl.insertInto(DRIVE_FILE)
              .set(DRIVE_FILE.SPACE_ID, spaceId)
              .set(DRIVE_FILE.FILE_ID, fileId)
              .set(DRIVE_FILE.NAME, name)
              .returning(DRIVE_FILE.ID)
              .fetchOne()
              .getId();
        });
  }

  private FilePreviewRepository.Row row(long fileId) {
    return inTenantTx(() -> previewRepo.find(fileId).orElse(null));
  }

  /** 비동기 변환이 목표 상태에 이를 때까지 기다린다(상한 5초·50ms 간격). */
  private void awaitStatus(long fileId, String status) {
    long deadline = System.currentTimeMillis() + 5_000;
    String last = null;
    while (System.currentTimeMillis() < deadline) {
      FilePreviewRepository.Row r = row(fileId);
      last = r == null ? null : r.status();
      if (status.equals(last)) {
        return;
      }
      sleep(50);
    }
    throw new AssertionError("상태 " + status + " 를 기다리다 시간 초과 — 마지막 상태: " + last);
  }

  /** 변환 목 결과 — 원본 내용을 담아 버전별로 다른 PDF 바이트를 만든다. */
  private static byte[] pdfOf(Path source) throws Exception {
    return pdfBytes(Files.readString(source, StandardCharsets.UTF_8));
  }

  private static byte[] pdfBytes(String originalBody) {
    return ("%PDF-1.7 " + originalBody).getBytes(StandardCharsets.UTF_8);
  }

  private Long insertUser(String username) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, username)
        .set(USER.EMAIL, username + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private static void sleep(long ms) {
    try {
      Thread.sleep(ms);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(e);
    }
  }

  private static String suffix() {
    return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
  }

  /** fixture 테넌트 GUC 를 심은 트랜잭션에서 실행하고 커밋한다. */
  private <T> T inTenantTx(Supplier<T> body) {
    return new TransactionTemplate(txManager)
        .execute(
            status -> {
              if (tid2 == null) {
                tid2 = ensureFixtureTenant();
              }
              dsl.execute("SELECT set_config('app.tenant_id', '" + tid2 + "', true)");
              return body.get();
            });
  }

  /** 고정 슬러그로 fixture 테넌트를 find-or-create(커밋) — tenant 행은 삭제 불가라 누적을 막는다. */
  private long ensureFixtureTenant() {
    Long existing =
        dsl.select(TENANT.ID)
            .from(TENANT)
            .where(TENANT.SLUG.eq(FIXTURE_TENANT_SLUG))
            .fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, FIXTURE_TENANT_SLUG)
        .set(TENANT.NAME, "Drive Preview Fixture Tenant")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }
}
