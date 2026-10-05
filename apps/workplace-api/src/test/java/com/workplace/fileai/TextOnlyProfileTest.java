package com.workplace.fileai;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workplace.fileai.outbound.AiAgentDriveClient;
import com.workplace.fileai.outbound.WorkerClient;
import com.workplace.fileai.repository.WorkerJobRepository;
import com.workplace.fileai.service.FileExtractionPipeline;
import com.workplace.fileai.service.FileExtractionPipeline.ExtractResult;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-242: TEXT_ONLY(첨부) 프로파일은 추출 후 바로 DONE 이 되고 요약·임베딩 경로에 들어가지 않는다. 워커 예외는 extract-error: 로 기록된다.
 */
@TestPropertySource(properties = "workplace.worker.enabled=true")
class TextOnlyProfileTest extends IntegrationTestBase {

  private static final long TENANT = 1L;

  @Autowired DSLContext dsl;
  @Autowired FileExtractionPipeline pipeline;
  @Autowired WorkerJobRepository jobs;

  @MockitoBean WorkerClient workerClient;
  @MockitoBean AiAgentDriveClient driveClient;

  private final List<Long> fileIds = new ArrayList<>();
  private final List<Long> userIds = new ArrayList<>();

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
    if (!userIds.isEmpty()) {
      new TransactionTemplate(txManager)
          .executeWithoutResult(s -> dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute());
      userIds.clear();
    }
  }

  @Test
  void TEXT_ONLY_추출_콜백은_바로_DONE_이고_요약을_부르지_않는다() throws Exception {
    long fileId = seedExtracting("TEXT_ONLY", "application/pdf");
    long jobId =
        inTenant(() -> jobs.createExtractJob(TENANT, fileId, "x/a.pdf", "application/pdf"));

    inTenantRun(
        () ->
            pipeline.applyExtractResult(
                jobId, new ExtractResult(TENANT, "DONE", "본문", 2, null, false, null)));
    Thread.sleep(300); // afterCommit 비동기 요약 nudge 가 있었다면 실행될 시간

    assertThat(status(fileId)).isEqualTo("DONE");
    verify(driveClient, never()).summarize(any());
  }

  @Test
  void FULL_추출_콜백은_TEXT_READY() {
    long fileId = seedExtracting("FULL", "application/pdf");
    long jobId =
        inTenant(() -> jobs.createExtractJob(TENANT, fileId, "x/a.pdf", "application/pdf"));
    inTenantRun(
        () ->
            pipeline.applyExtractResult(
                jobId, new ExtractResult(TENANT, "DONE", "본문", 2, null, false, null)));
    assertThat(status(fileId)).isIn("TEXT_READY", "SUMMARIZING", "DONE");
  }

  @Test
  void TEXT_ONLY_DONE_은_임베딩_백필_대상이_아니다() {
    long textOnly = seedDone("TEXT_ONLY");
    long full = seedDone("FULL");
    List<Long> embeddable = inTenant(() -> jobs.findEmbeddable(1000));
    assertThat(embeddable).contains(full).doesNotContain(textOnly);
    assertThat(inTenant(() -> jobs.findEmbedContext(textOnly))).isEmpty();
  }

  @Test
  void 워커_FAILED_는_extract_error_접두로_기록된다() {
    long fileId = seedExtracting("TEXT_ONLY", "application/pdf");
    long jobId =
        inTenant(() -> jobs.createExtractJob(TENANT, fileId, "x/a.pdf", "application/pdf"));
    String longMessage = "x".repeat(600);
    inTenantRun(
        () ->
            pipeline.applyExtractResult(
                jobId, new ExtractResult(TENANT, "FAILED", null, null, null, null, longMessage)));
    String error =
        inTenant(
            () ->
                dsl.select(FILE_EXTRACTION.ERROR)
                    .from(FILE_EXTRACTION)
                    .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                    .fetchOne(FILE_EXTRACTION.ERROR));
    assertThat(status(fileId)).isEqualTo("SKIPPED");
    assertThat(error).startsWith("extract-error:").hasSizeLessThanOrEqualTo(500);
  }

  @Test
  void TEXT_ONLY_는_재개_백스톱과_요약_클레임에서_제외된다() {
    // spec §7.4: TEXT_ONLY 는 요약 경로에 들어가면 안 된다 — TEXT_READY / 리스 만료 SUMMARIZING 모두 제외
    long textReady = seedWith("TEXT_ONLY", "TEXT_READY", 0, null);
    long expiredSummarizing =
        seedWith("TEXT_ONLY", "SUMMARIZING", 1, java.time.OffsetDateTime.now().minusMinutes(10));
    // 대조군: FULL TEXT_READY 는 재개 대상이어야 한다(테스트가 실패할 수 있음을 증명)
    long fullReady = seedWith("FULL", "TEXT_READY", 0, null);

    List<Long> resumable = inTenant(() -> jobs.findResumable());
    assertThat(resumable).contains(fullReady).doesNotContain(textReady, expiredSummarizing);
    assertThat(inTenant(() -> jobs.claimForSummary(textReady))).isFalse();
    assertThat(inTenant(() -> jobs.claimForSummary(expiredSummarizing))).isFalse();
  }

  // ── 헬퍼 ──────────────────────────────────────────────

  /** 사용자 + file + EXTRACTING 추출 행을 만든다(지정 프로파일). */
  private long seedExtracting(String profile, String mime) {
    long fileId = seedFile(mime);
    inTenantRun(
        () ->
            dsl.insertInto(FILE_EXTRACTION)
                .set(FILE_EXTRACTION.FILE_ID, fileId)
                .set(FILE_EXTRACTION.STATUS, "EXTRACTING")
                .set(FILE_EXTRACTION.PROFILE, profile)
                .set(FILE_EXTRACTION.TENANT_ID, TENANT)
                .execute());
    return fileId;
  }

  /** 지정 프로파일·상태·시도 횟수·리스 만료 시각의 추출 행을 만든다(텍스트 추출 완료 상태). */
  private long seedWith(
      String profile, String status, int attempts, java.time.OffsetDateTime leasedUntil) {
    long fileId = seedFile("application/pdf");
    inTenantRun(
        () ->
            dsl.insertInto(FILE_EXTRACTION)
                .set(FILE_EXTRACTION.FILE_ID, fileId)
                .set(FILE_EXTRACTION.STATUS, status)
                .set(FILE_EXTRACTION.EXTRACTED_TEXT, "본문")
                .set(FILE_EXTRACTION.CHAR_COUNT, 2)
                .set(FILE_EXTRACTION.PROFILE, profile)
                .set(FILE_EXTRACTION.ATTEMPTS, attempts)
                .set(FILE_EXTRACTION.LEASED_UNTIL, leasedUntil)
                .set(FILE_EXTRACTION.TENANT_ID, TENANT)
                .execute());
    return fileId;
  }

  /** DONE + embedding NULL 행을 만든다(임베딩 백필 후보). */
  private long seedDone(String profile) {
    long fileId = seedFile("text/plain");
    inTenantRun(
        () ->
            dsl.insertInto(FILE_EXTRACTION)
                .set(FILE_EXTRACTION.FILE_ID, fileId)
                .set(FILE_EXTRACTION.STATUS, "DONE")
                .set(FILE_EXTRACTION.EXTRACTED_TEXT, "본문")
                .set(FILE_EXTRACTION.CHAR_COUNT, 2)
                .set(FILE_EXTRACTION.PROFILE, profile)
                .set(FILE_EXTRACTION.TENANT_ID, TENANT)
                .execute());
    return fileId;
  }

  private long seedFile(String mime) {
    String suffix = String.valueOf(System.nanoTime());
    Long userId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "to-" + suffix)
                        .set(USER.NAME, "TO")
                        .set(USER.EMAIL, "to-" + suffix + "@example.com")
                        .set(USER.KIND, "HUMAN")
                        .returning(USER.ID)
                        .fetchOne()
                        .getId());
    userIds.add(userId);
    long fileId =
        inTenant(
            () ->
                dsl.insertInto(FILE)
                    .set(FILE.ORIGINAL_NAME, "a-" + suffix)
                    .set(FILE.STORED_NAME, "a-" + suffix)
                    .set(FILE.MIME_TYPE, mime)
                    .set(FILE.SIZE_BYTES, 10L)
                    .set(FILE.STORAGE_PATH, "x/a-" + suffix)
                    .set(FILE.UPLOADED_BY, userId)
                    .returning(FILE.ID)
                    .fetchOne()
                    .getId());
    fileIds.add(fileId);
    return fileId;
  }

  private String status(long fileId) {
    return inTenant(
        () ->
            dsl.select(FILE_EXTRACTION.STATUS)
                .from(FILE_EXTRACTION)
                .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                .fetchOne(FILE_EXTRACTION.STATUS));
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
