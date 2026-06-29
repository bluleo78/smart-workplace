package com.workplace.fileai.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKER_JOB;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doNothing;

import com.workplace.fileai.outbound.WorkerClient;
import com.workplace.fileai.repository.WorkerJobRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * FileEmbeddingScheduler 통합 테스트 — backfill() 이 DONE+embedding NULL 파일을 dispatchEmbed 하는지 검증.
 *
 * <p>@Transactional 금지: 스케줄러 내부 TenantScopedRunner 가 REQUIRES_NEW 트랜잭션을 열므로, 검증은 실제 커밋된 데이터를 대상으로
 * 한다. TenantContext.clear() 로 ambient GUC 마스킹을 방지한다.
 */
@TestPropertySource(properties = "workplace.worker.enabled=true")
class FileEmbeddingSchedulerTest extends IntegrationTestBase {

  /** 기본 테스트 테넌트. */
  private static final long TENANT_1 = 1L;

  @Autowired private FileEmbeddingScheduler scheduler;
  @Autowired private WorkerJobRepository repo;
  @Autowired private DSLContext dsl;

  /** WorkerClient mock — 실제 워커 HTTP 호출 차단. */
  @MockitoBean private WorkerClient workerClient;

  /** 테스트에서 삽입한 file_id 목록 — @AfterEach 정리용. */
  private final List<Long> createdFileIds = new ArrayList<>();

  /** 테스트에서 생성한 user_id 목록. */
  private final List<Long> createdUserIds = new ArrayList<>();

  @AfterEach
  void cleanup() {
    if (!createdFileIds.isEmpty()) {
      cleanupInTenant(
          TENANT_1,
          () -> {
            for (long fileId : createdFileIds) {
              dsl.deleteFrom(WORKER_JOB)
                  .where(WORKER_JOB.PARAMS.contains(JSONB.valueOf("{\"fileId\":" + fileId + "}")))
                  .execute();
            }
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

  /**
   * backfill() 이 DONE+embedding NULL 파일을 dispatchEmbed 해 embed 잡을 생성하는지 검증.
   *
   * <p>TenantContext.clear() 로 ambient GUC 를 제거해 스케줄러가 테넌트별 GUC 주입을 직접 담당하도록 한다(마스킹 방지).
   */
  @Test
  void backfill_dispatches_embeddable_done_files_missing_embedding() {
    doNothing().when(workerClient).dispatchEmbed(anyLong(), anyString(), anyLong());

    long fileId = seedDoneExtractionNoEmbedding(TENANT_1);
    // ambient GUC 마스킹 방지 — 스케줄러가 테넌트별 set/clear 담당
    TenantContext.clear();
    scheduler.backfill();

    // dispatchEmbed 가 호출되어 RUNNING embed 잡이 생성되어야 함
    assertThat(runAsTenant(TENANT_1, () -> repo.hasPendingEmbedJob(fileId)))
        .describedAs("backfill 후 embed RUNNING 잡 존재(hasPendingEmbedJob=true)")
        .isTrue();
  }

  // ── 헬퍼 ────────────────────────────────────────────────────────────────────

  /**
   * DONE + embedding NULL + 살아있는 embed 잡 없는 FILE_EXTRACTION 행을 시드. findEmbeddable 조건을 정확히 충족한다.
   *
   * @param tenantId 삽입 대상 테넌트
   * @return 생성된 file_id
   */
  private long seedDoneExtractionNoEmbedding(long tenantId) {
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
    Long userId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "sched-test-" + suffix)
                        .set(USER.NAME, "Sched Test")
                        .set(USER.EMAIL, "sched-test-" + suffix + "@example.com")
                        .set(USER.KIND, "HUMAN")
                        .returning(USER.ID)
                        .fetchOne()
                        .getId());
    createdUserIds.add(userId);

    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              s -> {
                long fileId =
                    dsl.insertInto(FILE)
                        .set(FILE.ORIGINAL_NAME, "sched-" + suffix + ".pdf")
                        .set(FILE.STORED_NAME, "sched-" + suffix + ".pdf")
                        .set(FILE.MIME_TYPE, "application/pdf")
                        .set(FILE.SIZE_BYTES, 100L)
                        .set(FILE.STORAGE_PATH, "drive/sched-" + suffix + ".pdf")
                        .set(FILE.UPLOADED_BY, userId)
                        .returning(FILE.ID)
                        .fetchOne()
                        .getId();
                dsl.insertInto(FILE_EXTRACTION)
                    .set(FILE_EXTRACTION.FILE_ID, fileId)
                    .set(FILE_EXTRACTION.STATUS, "DONE")
                    .set(FILE_EXTRACTION.EXTRACTED_TEXT, "스케줄러 테스트 본문")
                    .set(FILE_EXTRACTION.TENANT_ID, tenantId)
                    // embedding 은 NULL 로 두어 findEmbeddable 에 포함되도록 함
                    .execute();
                createdFileIds.add(fileId);
                return fileId;
              });
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /**
   * 지정 테넌트 컨텍스트에서 Callable 을 실행하고 결과를 반환한다.
   *
   * <p>TenantContext 를 설정하고 txTemplate 으로 트랜잭션을 열어 GUC 가 주입되도록 한다(RLS-safe).
   */
  private <T> T runAsTenant(long tenantId, java.util.concurrent.Callable<T> action) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              s -> {
                try {
                  return action.call();
                } catch (RuntimeException e) {
                  throw e;
                } catch (Exception e) {
                  throw new RuntimeException(e);
                }
              });
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }
}
