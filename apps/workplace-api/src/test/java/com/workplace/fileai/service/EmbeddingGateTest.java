package com.workplace.fileai.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKER_JOB;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
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
 * 임베딩 게이트 분리 검증 — 워커는 활성이나 임베딩 게이트(embed.enabled)만 false 인 상태에서 임베딩 디스패치가 일어나지 않고 추출 경로는 무영향임을
 * 확인한다.
 */
@TestPropertySource(
    properties = {"workplace.worker.enabled=true", "workplace.worker.embed.enabled=false"})
class EmbeddingGateTest extends IntegrationTestBase {

  private static final long TENANT_1 = 1L;

  @Autowired private FileEmbeddingPipeline pipeline;
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
  void embedGateOff_dispatchEmbed_noJobNoWorkerCall() {
    // DONE 상태 파일(추출 텍스트 보유) 시드 — 임베딩 후보
    long fileId = createDoneFile();

    TenantContext.set(TENANT_1);
    try {
      pipeline.dispatchEmbed(fileId);
    } finally {
      TenantContext.clear();
    }

    // 게이트 off → embed worker_job 미생성 + 워커 호출 없음
    Integer embedJobs =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  TenantContext.set(TENANT_1);
                  try {
                    return dsl.fetchCount(
                        dsl.selectFrom(WORKER_JOB)
                            .where(WORKER_JOB.TASK_TYPE.eq("embed"))
                            .and(
                                WORKER_JOB.PARAMS.contains(
                                    org.jooq.JSONB.valueOf("{\"fileId\":" + fileId + "}"))));
                  } finally {
                    TenantContext.clear();
                  }
                });
    assertThat(embedJobs).isZero();
    verify(workerClient, never()).dispatchEmbed(anyLong(), anyString(), anyLong());
  }

  /** DONE + 추출 텍스트 보유 FILE/FILE_EXTRACTION 행 생성. */
  private long createDoneFile() {
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
    createdUserId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "eg-test-" + suffix)
                        .set(USER.NAME, "EG Test")
                        .set(USER.EMAIL, "eg-test-" + suffix + "@example.com")
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
                        .set(FILE.ORIGINAL_NAME, "eg-" + suffix + ".txt")
                        .set(FILE.STORED_NAME, "eg-" + suffix + ".txt")
                        .set(FILE.MIME_TYPE, "text/plain")
                        .set(FILE.SIZE_BYTES, 10L)
                        .set(FILE.STORAGE_PATH, "drive/eg-" + suffix + ".txt")
                        .set(FILE.UPLOADED_BY, createdUserId)
                        .returning(FILE.ID)
                        .fetchOne()
                        .getId();
                dsl.insertInto(FILE_EXTRACTION)
                    .set(FILE_EXTRACTION.FILE_ID, fileId)
                    .set(FILE_EXTRACTION.STATUS, "DONE")
                    .set(FILE_EXTRACTION.EXTRACTED_TEXT, "hello world")
                    .set(FILE_EXTRACTION.CHAR_COUNT, 11)
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
