package com.workplace.fileai.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKER_JOB;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workplace.fileai.outbound.WorkerClient;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 추출 게이트 검증 — 워커 비활성(worker.enabled=false) 시 dispatchPending 이 claim·worker_job·워커호출을 일절 하지 않고 파일을
 * PENDING 으로 유지함을 확인한다(스팸·고착 방지).
 */
@TestPropertySource(properties = "workplace.worker.enabled=false")
class ExtractionGateTest extends IntegrationTestBase {

  private static final long TENANT_1 = 1L;

  @Autowired private FileExtractionPipeline pipeline;
  @Autowired private DSLContext dsl;
  @MockitoBean private WorkerClient workerClient;

  private Long createdFileId;
  private Long createdUserId;

  @AfterEach
  void cleanup() {
    if (createdFileId != null) {
      cleanupInTenant(
          TENANT_1,
          () -> {
            dsl.deleteFrom(WORKER_JOB)
                .where(
                    WORKER_JOB.PARAMS.contains(
                        org.jooq.JSONB.valueOf("{\"fileId\":" + createdFileId + "}")))
                .execute();
            dsl.deleteFrom(FILE_EXTRACTION)
                .where(FILE_EXTRACTION.FILE_ID.eq(createdFileId))
                .execute();
            dsl.deleteFrom(FILE).where(FILE.ID.eq(createdFileId)).execute();
          });
    }
    if (createdUserId != null) {
      dsl.deleteFrom(USER).where(USER.ID.eq(createdUserId)).execute();
    }
  }

  @Test
  void workerDisabled_dispatchPending_staysPendingNoJobNoCall() {
    long fileId = createPendingFile();

    TenantContext.set(TENANT_1);
    try {
      pipeline.dispatchPending(fileId);
    } finally {
      TenantContext.clear();
    }

    assertThat(readStatus(fileId)).isEqualTo("PENDING");
    assertThat(extractJobCount(fileId)).isZero();
    verify(workerClient, never()).dispatchExtract(anyLong(), any(), any(), anyLong());
  }

  private String readStatus(long fileId) {
    return new TransactionTemplate(txManager)
        .execute(
            s -> {
              TenantContext.set(TENANT_1);
              try {
                return dsl.select(FILE_EXTRACTION.STATUS)
                    .from(FILE_EXTRACTION)
                    .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                    .fetchOne(FILE_EXTRACTION.STATUS);
              } finally {
                TenantContext.clear();
              }
            });
  }

  private int extractJobCount(long fileId) {
    return new TransactionTemplate(txManager)
        .execute(
            s -> {
              TenantContext.set(TENANT_1);
              try {
                return dsl.fetchCount(
                    dsl.selectFrom(WORKER_JOB)
                        .where(WORKER_JOB.TASK_TYPE.eq("extract"))
                        .and(
                            WORKER_JOB.PARAMS.contains(
                                org.jooq.JSONB.valueOf("{\"fileId\":" + fileId + "}"))));
              } finally {
                TenantContext.clear();
              }
            });
  }

  private long createPendingFile() {
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
    createdUserId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "xg-test-" + suffix)
                        .set(USER.NAME, "XG Test")
                        .set(USER.EMAIL, "xg-test-" + suffix + "@example.com")
                        .set(USER.KIND, "HUMAN")
                        .returning(USER.ID)
                        .fetchOne()
                        .getId());
    TenantContext.set(TENANT_1);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              s -> {
                long fileId =
                    dsl.insertInto(FILE)
                        .set(FILE.ORIGINAL_NAME, "xg-" + suffix + ".pdf")
                        .set(FILE.STORED_NAME, "xg-" + suffix + ".pdf")
                        .set(FILE.MIME_TYPE, "application/pdf")
                        .set(FILE.SIZE_BYTES, 100L)
                        .set(FILE.STORAGE_PATH, "drive/xg-" + suffix + ".pdf")
                        .set(FILE.UPLOADED_BY, createdUserId)
                        .returning(FILE.ID)
                        .fetchOne()
                        .getId();
                dsl.insertInto(FILE_EXTRACTION)
                    .set(FILE_EXTRACTION.FILE_ID, fileId)
                    .set(FILE_EXTRACTION.STATUS, "PENDING")
                    .set(FILE_EXTRACTION.TENANT_ID, TENANT_1)
                    .execute();
                createdFileId = fileId;
                return fileId;
              });
    } finally {
      TenantContext.clear();
    }
  }
}
