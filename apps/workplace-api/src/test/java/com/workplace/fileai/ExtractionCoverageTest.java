package com.workplace.fileai;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;

import com.workplace.drive.outbound.DriveFileUploadedEvent;
import com.workplace.fileai.outbound.WorkerClient;
import com.workplace.fileai.repository.FileExtractionRepository;
import com.workplace.fileai.repository.WorkerJobRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * mime 축 추출 판정 확장(#735) 커버리지 통합 테스트. {@link FileExtractionListenerTest} 의 카테고리 축 테스트를 mime 축으로 보완한다
 * — html 확장 지원, 미지원 mime 사유 문자열, 재개방 백필 로직, findResumable 배치 상한을 검증한다.
 */
@TestPropertySource(properties = "workplace.worker.enabled=true")
class ExtractionCoverageTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ApplicationEventPublisher publisher;
  @Autowired WorkerJobRepository jobRepo;
  @Autowired FileExtractionRepository extractionRepo;

  /** WorkerClient mock — 리스너 nudge 의 HTTP push 차단(실제 워커 미기동 환경). */
  @MockitoBean WorkerClient workerClient;

  private final List<Long> createdFileIds = new ArrayList<>();
  private final List<Long> createdUserIds = new ArrayList<>();

  @AfterEach
  void cleanup() {
    if (!createdFileIds.isEmpty()) {
      cleanupInTenant(
          1L,
          () -> {
            dsl.deleteFrom(FILE_EXTRACTION)
                .where(FILE_EXTRACTION.FILE_ID.in(createdFileIds))
                .execute();
            dsl.deleteFrom(FILE).where(FILE.ID.in(createdFileIds)).execute();
          });
      createdFileIds.clear();
    }
    if (!createdUserIds.isEmpty()) {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              s -> dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute());
      createdUserIds.clear();
    }
  }

  @Test
  void htmlFile_isPending() {
    // #735 진범 — text/html 은 카테고리 매핑이 없어도(또는 TEXT 로 매핑돼도) mime 축 판정으로 추출 가능해야 한다.
    doNothing().when(workerClient).dispatchExtract(any(Long.class), any(), any(), any(Long.class));
    long fileId = createFileInTenant(1L, "text/html");
    publishInTenant(
        1L, new DriveFileUploadedEvent(fileId, 1L, "text/html", "TEXT", 10, "x/f.html"));
    // nudge 로 EXTRACTING 까지 전이(PENDING 은 즉시 소비됨) — 최소한 SKIPPED 가 아니어야 한다.
    assertThat(readStatusInTenant(1L, fileId)).isEqualTo("EXTRACTING");
  }

  @Test
  void imageFile_skipReasonStartsWithImage() {
    long fileId = createFileInTenant(1L, "image/png");
    publishInTenant(
        1L, new DriveFileUploadedEvent(fileId, 1L, "image/png", "IMAGE", 10, "x/f.png"));
    assertThat(readStatusInTenant(1L, fileId)).isEqualTo("SKIPPED");
    assertThat(readErrorInTenant(1L, fileId)).startsWith("image:");
  }

  @Test
  void zipFile_skipReasonStartsWithUnsupportedMime() {
    long fileId = createFileInTenant(1L, "application/zip");
    publishInTenant(
        1L, new DriveFileUploadedEvent(fileId, 1L, "application/zip", "OTHER", 10, "x/f.zip"));
    assertThat(readStatusInTenant(1L, fileId)).isEqualTo("SKIPPED");
    assertThat(readErrorInTenant(1L, fileId)).startsWith("unsupported-mime:");
  }

  @Test
  void reopenUnsupportedSkipped_reopensNonExtractableHtmlRow_butNotImageRow() {
    // 카테고리 게이트 시절 SKIPPED 로 굳은 행 2건을 직접 시드: html(재개방 대상), image(그대로 유지).
    long htmlFileId = createFileInTenant(1L, "text/html");
    long imageFileId = createFileInTenant(1L, "image/png");
    seedLegacySkipped(1L, htmlFileId, "non-extractable:OTHER");
    seedLegacySkipped(1L, imageFileId, "non-extractable:IMAGE");

    TenantContext.set(1L);
    Integer reopened;
    try {
      reopened =
          new TransactionTemplate(txManager)
              .execute(s -> extractionRepo.reopenUnsupportedSkipped());
    } finally {
      TenantContext.clear();
    }

    assertThat(reopened).isGreaterThanOrEqualTo(1);
    assertThat(readStatusInTenant(1L, htmlFileId)).isEqualTo("PENDING");
    assertThat(readErrorInTenant(1L, htmlFileId)).isNull();
    // image 는 mime 이 IN 목록에 없으므로 재개방 조건 불충족 — SKIPPED 유지
    assertThat(readStatusInTenant(1L, imageFileId)).isEqualTo("SKIPPED");
  }

  @Test
  void findResumable_isCappedByResumeBatchSize() {
    // 기본 resume-batch-size=50. 이를 넘는 PENDING 행을 만들어 결과 크기가 상한과 같은지 확인한다.
    int extra = 55;
    List<Long> fileIds = new ArrayList<>();
    for (int i = 0; i < extra; i++) {
      long fileId = createFileInTenant(1L, "text/plain");
      seedPending(1L, fileId);
      fileIds.add(fileId);
    }

    TenantContext.set(1L);
    List<Long> resumable;
    try {
      resumable = new TransactionTemplate(txManager).execute(s -> jobRepo.findResumable());
    } finally {
      TenantContext.clear();
    }

    assertThat(resumable.size()).isLessThanOrEqualTo(50);
  }

  @Test
  void normalizeOctetStreamMimes_hwpxTakesPrecedenceOverHwp_andOtherExtensionsMap() {
    // V124 UPDATE ① 미러 검증 — 특히 .hwpx 가 LIKE '%.hwp' 분기에 먹히지 않는지가 핵심(코드 리뷰로만 확인돼 있던 갭).
    long hwpxFileId = createFileInTenantWithName(1L, "application/octet-stream", "보고서.hwpx");
    long hwpFileId = createFileInTenantWithName(1L, "application/octet-stream", "보고서.hwp");
    long htmlFileId = createFileInTenantWithName(1L, "application/octet-stream", "index.html");
    // 이미 구체적 mime 인 행은 octet-stream 이 아니므로 WHERE 절에 안 걸려 변경되지 않아야 한다.
    long csvFileId = createFileInTenantWithName(1L, "text/csv", "data.csv");

    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(s -> extractionRepo.normalizeOctetStreamMimes());
    } finally {
      TenantContext.clear();
    }

    assertThat(readMimeInTenant(1L, hwpxFileId)).isEqualTo("application/hwp+zip");
    assertThat(readMimeInTenant(1L, hwpFileId)).isEqualTo("application/x-hwp");
    assertThat(readMimeInTenant(1L, htmlFileId)).isEqualTo("text/html");
    assertThat(readMimeInTenant(1L, csvFileId)).isEqualTo("text/csv");
  }

  // ---------------------------------------------------------------- 헬퍼

  private long createFileInTenant(long tenantId, String mimeType) {
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
    return createFileInTenantWithName(tenantId, mimeType, "test-" + suffix + ".dat");
  }

  /** 파일명을 직접 지정해 FILE 행을 생성한다(V124 UPDATE ① 확장자 CASE 검증용). */
  private long createFileInTenantWithName(long tenantId, String mimeType, String originalName) {
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
    Long userId =
        new TransactionTemplate(txManager)
            .execute(
                status ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "ec-test-" + suffix)
                        .set(USER.NAME, "EC Test User")
                        .set(USER.EMAIL, "ec-test-" + suffix + "@example.com")
                        .set(USER.KIND, "HUMAN")
                        .returning(USER.ID)
                        .fetchOne()
                        .getId());
    createdUserIds.add(userId);

    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      Long fileId =
          new TransactionTemplate(txManager)
              .execute(
                  status ->
                      dsl.insertInto(FILE)
                          .set(FILE.ORIGINAL_NAME, originalName)
                          .set(FILE.STORED_NAME, "stored-" + suffix)
                          .set(FILE.MIME_TYPE, mimeType)
                          .set(FILE.SIZE_BYTES, 10L)
                          .set(FILE.STORAGE_PATH, "x/stored-" + suffix)
                          .set(FILE.UPLOADED_BY, userId)
                          .returning(FILE.ID)
                          .fetchOne()
                          .getId());
      createdFileIds.add(fileId);
      return fileId;
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  private void publishInTenant(long tenantId, DriveFileUploadedEvent event) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(status -> publisher.publishEvent(event));
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /** 카테고리 게이트 시절 SKIPPED 행을 직접 시드(마이그레이션 재개방 대상 재현). */
  private void seedLegacySkipped(long tenantId, long fileId, String error) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              s ->
                  dsl.insertInto(FILE_EXTRACTION)
                      .set(FILE_EXTRACTION.FILE_ID, fileId)
                      .set(FILE_EXTRACTION.STATUS, "SKIPPED")
                      .set(FILE_EXTRACTION.ERROR, error)
                      .set(FILE_EXTRACTION.TENANT_ID, tenantId)
                      .execute());
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /** findResumable 상한 테스트용 — leased_until 없는 PENDING 행 직접 시드. */
  private void seedPending(long tenantId, long fileId) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              s ->
                  dsl.insertInto(FILE_EXTRACTION)
                      .set(FILE_EXTRACTION.FILE_ID, fileId)
                      .set(FILE_EXTRACTION.STATUS, "PENDING")
                      .set(FILE_EXTRACTION.TENANT_ID, tenantId)
                      .execute());
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  private String readStatusInTenant(long tenantId, long fileId) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              status ->
                  dsl.select(FILE_EXTRACTION.STATUS)
                      .from(FILE_EXTRACTION)
                      .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                      .fetchOne(FILE_EXTRACTION.STATUS));
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  private String readErrorInTenant(long tenantId, long fileId) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              status ->
                  dsl.select(FILE_EXTRACTION.ERROR)
                      .from(FILE_EXTRACTION)
                      .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                      .fetchOne(FILE_EXTRACTION.ERROR));
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /** V124 UPDATE ① 검증용 — FILE.MIME_TYPE 조회. */
  private String readMimeInTenant(long tenantId, long fileId) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              status ->
                  dsl.select(FILE.MIME_TYPE)
                      .from(FILE)
                      .where(FILE.ID.eq(fileId))
                      .fetchOne(FILE.MIME_TYPE));
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }
}
