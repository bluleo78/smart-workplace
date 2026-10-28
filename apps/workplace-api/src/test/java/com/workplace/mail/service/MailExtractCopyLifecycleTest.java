package com.workplace.mail.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.file.storage.FileStore;
import com.workplace.fileai.outbound.AiAgentDriveClient;
import com.workplace.fileai.outbound.WorkerClient;
import com.workplace.fileai.repository.WorkerJobRepository;
import com.workplace.fileai.service.ExtractedTextService;
import com.workplace.fileai.service.FileExtractionPipeline;
import com.workplace.fileai.service.FileExtractionPipeline.ExtractResult;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.ExternalClientMockedTestBase;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 추출 사본의 평문 바이너리 수명(WP-358) — 실제 커밋이 필요해(AFTER_COMMIT 리스너·롤백 콜백) 비-@Transactional 로 돌린다.
 *
 * <ul>
 *   <li>워커 결과 확정(텍스트 저장·SKIPPED) 커밋 후 사본 바이너리를 지우고, file 행·추출 텍스트는 남아 /text 가 계속 읽힌다.
 *   <li>사본이 아닌 파일(일반 첨부)의 바이너리는 건드리지 않는다.
 *   <li>사본 생성 트랜잭션이 롤백되면 방금 쓴 평문 바이너리를 지운다.
 * </ul>
 *
 * <p>TextOnlyProfileTest 와 같은 컨텍스트 설정(워커 활성 + 워커·요약 클라이언트 mock)을 써 컨텍스트 캐시를 공유한다.
 */
@TestPropertySource(properties = "workplace.worker.enabled=true")
class MailExtractCopyLifecycleTest extends ExternalClientMockedTestBase {

  private static final long TENANT = 1L;

  @Autowired DSLContext dsl;
  @Autowired MailExtractCopyStore copyStore;
  @Autowired FileExtractionPipeline pipeline;
  @Autowired WorkerJobRepository jobs;
  @Autowired ExtractedTextService extractedText;
  @Autowired FileStore fileStore;

  @Autowired WorkerClient workerClient;
  @Autowired AiAgentDriveClient driveClient;

  private final List<Long> fileIds = new ArrayList<>();
  private final List<Long> userIds = new ArrayList<>();
  private final List<String> paths = new ArrayList<>();

  @AfterEach
  void cleanup() {
    if (!fileIds.isEmpty()) {
      cleanupInTenant(
          TENANT,
          () -> {
            dsl.execute(
                "DELETE FROM worker_job WHERE params ->> 'fileId' IN ("
                    + String.join(",", fileIds.stream().map(id -> "'" + id + "'").toList())
                    + ")");
            dsl.deleteFrom(FILE_EXTRACTION).where(FILE_EXTRACTION.FILE_ID.in(fileIds)).execute();
            dsl.deleteFrom(FILE).where(FILE.ID.in(fileIds)).execute();
          });
      fileIds.clear();
    }
    paths.forEach(fileStore::deleteIfExists);
    paths.clear();
    if (!userIds.isEmpty()) {
      new TransactionTemplate(txManager)
          .executeWithoutResult(s -> dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute());
      userIds.clear();
    }
  }

  @Test
  void 추출_텍스트가_저장되면_사본_바이너리를_지우고_텍스트는_계속_읽힌다() {
    long fileId = seedCopyExtracting();
    String path = storagePath(fileId);
    assertThat(Files.exists(fileStore.resolve(path))).isTrue();

    long jobId = inTenant(() -> jobs.createExtractJob(TENANT, fileId, path, "application/pdf"));
    inTenantRun(
        () ->
            pipeline.applyExtractResult(
                jobId, new ExtractResult(TENANT, "DONE", "가나다라", 4, null, false, null, null)));

    assertThat(Files.exists(fileStore.resolve(path))).isFalse();
    var slice = inTenant(() -> extractedText.read(fileId, 1, 2));
    assertThat(slice.status()).isEqualTo("READY");
    assertThat(slice.text()).isEqualTo("나다");
  }

  @Test
  void 추출_불가로_확정돼도_사본_바이너리를_지운다() {
    long fileId = seedCopyExtracting();
    String path = storagePath(fileId);
    long jobId = inTenant(() -> jobs.createExtractJob(TENANT, fileId, path, "application/pdf"));
    inTenantRun(
        () ->
            pipeline.applyExtractResult(
                jobId, new ExtractResult(TENANT, "FAILED", null, null, null, null, "boom", null)));

    assertThat(Files.exists(fileStore.resolve(path))).isFalse();
    assertThat(inTenant(() -> extractedText.read(fileId, 0, 10)).status()).isEqualTo("SKIPPED");
  }

  @Test
  void 사본이_아닌_파일의_바이너리는_지우지_않는다() {
    long userId = seedUser();
    String path = "tenant-1/issue/test/" + System.nanoTime() + ".pdf";
    paths.add(path);
    long fileId =
        inTenant(
            () -> {
              fileStore.storeBytes(path, "%PDF".getBytes());
              return dsl.insertInto(FILE)
                  .set(FILE.ORIGINAL_NAME, "a.pdf")
                  .set(FILE.STORED_NAME, "a.pdf")
                  .set(FILE.MIME_TYPE, "application/pdf")
                  .set(FILE.SIZE_BYTES, 4L)
                  .set(FILE.CATEGORY, "ATTACHMENT")
                  .set(FILE.STORAGE_PATH, path)
                  .set(FILE.UPLOADED_BY, userId)
                  .returning(FILE.ID)
                  .fetchOne()
                  .getId();
            });
    fileIds.add(fileId);
    insertExtracting(fileId);
    long jobId = inTenant(() -> jobs.createExtractJob(TENANT, fileId, path, "application/pdf"));
    inTenantRun(
        () ->
            pipeline.applyExtractResult(
                jobId, new ExtractResult(TENANT, "DONE", "본문", 2, null, false, null, null)));

    assertThat(Files.exists(fileStore.resolve(path))).isTrue();
  }

  @Test
  void 사본_생성_트랜잭션이_롤백되면_평문_바이너리를_지운다() {
    long userId = seedUser();
    String[] holder = new String[1];
    TenantContext.set(TENANT);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              s -> {
                long fileId = copyStore.store("secret".getBytes(), "a.txt", "text/plain", userId);
                holder[0] =
                    dsl.select(FILE.STORAGE_PATH)
                        .from(FILE)
                        .where(FILE.ID.eq(fileId))
                        .fetchOne(FILE.STORAGE_PATH);
                assertThat(Files.exists(fileStore.resolve(holder[0]))).isTrue();
                s.setRollbackOnly();
              });
    } finally {
      TenantContext.clear();
    }
    paths.add(holder[0]);
    assertThat(Files.exists(fileStore.resolve(holder[0]))).isFalse();
  }

  // ── 헬퍼 ──────────────────────────────────────────────

  /** 사용자 + 메일 추출 사본(바이너리 포함) + EXTRACTING TEXT_ONLY 추출 행. */
  private long seedCopyExtracting() {
    long userId = seedUser();
    long fileId =
        inTenant(
            () -> copyStore.store("%PDF-1.4".getBytes(), "spec.pdf", "application/pdf", userId));
    fileIds.add(fileId);
    paths.add(storagePath(fileId));
    insertExtracting(fileId);
    return fileId;
  }

  private void insertExtracting(long fileId) {
    inTenantRun(
        () ->
            dsl.insertInto(FILE_EXTRACTION)
                .set(FILE_EXTRACTION.FILE_ID, fileId)
                .set(FILE_EXTRACTION.STATUS, "EXTRACTING")
                .set(FILE_EXTRACTION.PROFILE, "TEXT_ONLY")
                .set(FILE_EXTRACTION.TENANT_ID, TENANT)
                .execute());
  }

  private String storagePath(long fileId) {
    return inTenant(
        () ->
            dsl.select(FILE.STORAGE_PATH)
                .from(FILE)
                .where(FILE.ID.eq(fileId))
                .fetchOne(FILE.STORAGE_PATH));
  }

  private long seedUser() {
    String suffix = String.valueOf(System.nanoTime());
    Long userId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "mx-" + suffix)
                        .set(USER.NAME, "MX")
                        .set(USER.EMAIL, "mx-" + suffix + "@example.com")
                        .set(USER.KIND, "HUMAN")
                        .returning(USER.ID)
                        .fetchOne()
                        .getId());
    userIds.add(userId);
    return userId;
  }

  private <T> T inTenant(Supplier<T> body) {
    TenantContext.set(TENANT);
    try {
      return new TransactionTemplate(txManager).execute(s -> body.get());
    } finally {
      TenantContext.clear();
    }
  }

  private void inTenantRun(Runnable body) {
    inTenant(
        () -> {
          body.run();
          return null;
        });
  }
}
