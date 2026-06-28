package com.workplace.fileai;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKER_JOB;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.fileai.outbound.WorkerClient;
import com.workplace.fileai.service.FileExtractionPipeline;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * FileExtractionPipeline + WorkerCallbackController 통합 테스트.
 *
 * <p>PENDING→EXTRACTING CAS, worker_job 생성, WorkerClient push(mock), 콜백 TEXT_READY 전이, 스테일 콜백 무시를
 * 검증한다. WorkerClient 는 MockitoBean 으로 대체해 실제 워커 HTTP 호출을 차단한다.
 */
@AutoConfigureMockMvc
class ExtractionPipelineTest extends IntegrationTestBase {

  /** 테스트 프로파일의 workplace.worker.internal-token 값 (WorkerProperties.internalToken()). */
  private static final String INTERNAL_TOKEN = "test-token";

  @Autowired private MockMvc mockMvc;
  @Autowired private FileExtractionPipeline pipeline;
  @Autowired private DSLContext dsl;

  /** WorkerClient mock — 실제 워커 HTTP 호출 차단. */
  @MockitoBean private WorkerClient workerClient;

  /** 테스트에서 삽입한 file_id 목록 — @AfterEach 정리용. */
  private final List<Long> createdFileIds = new ArrayList<>();

  /** 테스트에서 생성한 user_id 목록 — @AfterEach 정리용. */
  private final List<Long> createdUserIds = new ArrayList<>();

  /** 테넌트2에서 생성한 file_id 목록 — @AfterEach 테넌트2 컨텍스트로 별도 정리. */
  private final List<Long> createdFileIdsTenant2 = new ArrayList<>();

  /**
   * 동적으로 생성한 테넌트 ID 목록 — 파일 정리 컨텍스트 키로만 사용. app_tenant 롤은 tenant 테이블에 DELETE 권한 없음 → 테넌트 행은 테스트 DB
   * 에 잔류(소량 허용).
   */
  private final List<Long> createdTenantIds = new ArrayList<>();

  @AfterEach
  void cleanup() {
    if (!createdFileIds.isEmpty()) {
      cleanupInTenant(
          1L,
          () -> {
            // worker_job: FK 없음, params JSONB @> 로 삭제
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
    // 동적 생성 테넌트의 파일: 해당 테넌트 컨텍스트에서 RLS-safe 정리 후 테넌트 행 삭제
    if (!createdFileIdsTenant2.isEmpty() && !createdTenantIds.isEmpty()) {
      for (long tenantId : createdTenantIds) {
        final long tid = tenantId;
        cleanupInTenant(
            tid,
            () -> {
              for (long fileId : createdFileIdsTenant2) {
                dsl.deleteFrom(WORKER_JOB)
                    .where(WORKER_JOB.PARAMS.contains(JSONB.valueOf("{\"fileId\":" + fileId + "}")))
                    .execute();
              }
              dsl.deleteFrom(FILE_EXTRACTION)
                  .where(FILE_EXTRACTION.FILE_ID.in(createdFileIdsTenant2))
                  .execute();
              dsl.deleteFrom(FILE).where(FILE.ID.in(createdFileIdsTenant2)).execute();
            });
      }
      createdFileIdsTenant2.clear();
    }
    // 테넌트 행: app_tenant 롤에 DELETE 권한 없음 → 정리 생략(소량 잔류 허용)
    createdTenantIds.clear();
    if (!createdUserIds.isEmpty()) {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              s -> dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute());
      createdUserIds.clear();
    }
  }

  /**
   * 핵심 E2E 시나리오: PENDING 행 → dispatchPending → EXTRACTING + worker_job 생성 → 콜백 → TEXT_READY +
   * extracted_text 저장.
   */
  @Test
  void dispatch_thenCallback_setsTextReady() throws Exception {
    doNothing().when(workerClient).dispatchExtract(any(Long.class), any(), any(), any(Long.class));

    long fileId = createPendingFile(1L);

    // dispatchPending: PENDING→EXTRACTING + worker_job 생성 + WorkerClient 호출
    // TenantContext 는 @Transactional doBegin 의 GUC 주입에 필요 (worker_job FORCE RLS)
    TenantContext.set(1L);
    try {
      pipeline.dispatchPending(fileId);
    } finally {
      TenantContext.clear();
    }

    assertThat(readStatus(1L, fileId)).isEqualTo("EXTRACTING");
    long jobId = latestJobId(1L, fileId);
    verify(workerClient, atLeastOnce()).dispatchExtract(eq(jobId), any(), any(), any(Long.class));

    // 콜백: worker→api POST /internal/worker/jobs/{jobId}/result
    mockMvc
        .perform(
            post("/internal/worker/jobs/{id}/result", jobId)
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"status\":\"DONE\",\"text\":\"hello world\",\"charCount\":11,\"truncated\":false}"))
        .andExpect(status().isOk());

    assertThat(readStatus(1L, fileId)).isEqualTo("TEXT_READY");
    assertThat(readText(1L, fileId)).isEqualTo("hello world");
    assertThat(readCharCount(1L, fileId)).isEqualTo(11);
  }

  /** 스테일 콜백: DONE 콜백 → TEXT_READY 전이 후 두 번째 DONE 콜백은 무시(이미 TEXT_READY). */
  @Test
  void staleCallback_isIgnored() throws Exception {
    doNothing().when(workerClient).dispatchExtract(any(Long.class), any(), any(), any(Long.class));

    long fileId = createPendingFile(1L);
    TenantContext.set(1L);
    try {
      pipeline.dispatchPending(fileId);
    } finally {
      TenantContext.clear();
    }
    long jobId = latestJobId(1L, fileId);

    // 첫 번째 콜백 → TEXT_READY
    mockMvc
        .perform(
            post("/internal/worker/jobs/{id}/result", jobId)
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"status\":\"DONE\",\"text\":\"first\",\"charCount\":5,\"truncated\":false}"))
        .andExpect(status().isOk());

    assertThat(readStatus(1L, fileId)).isEqualTo("TEXT_READY");

    // 두 번째 콜백 → 이미 TEXT_READY(EXTRACTING 아님) → CAS 무시, 상태 변경 없음
    mockMvc
        .perform(
            post("/internal/worker/jobs/{id}/result", jobId)
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"status\":\"DONE\",\"text\":\"overwrite\",\"charCount\":9,\"truncated\":false}"))
        .andExpect(status().isOk());

    // 여전히 TEXT_READY, 텍스트 변경 없음
    assertThat(readText(1L, fileId)).isEqualTo("first");
  }

  /** 동시 2회 dispatchPending → CAS 로 worker_job 이 1개만 생성됨(이중 잡 방지). */
  @Test
  void concurrentDispatch_createsSingleJob() throws Exception {
    doNothing().when(workerClient).dispatchExtract(any(Long.class), any(), any(), any(Long.class));

    long fileId = createPendingFile(1L);

    int threads = 2;
    var latch = new CountDownLatch(1);
    var executor = Executors.newFixedThreadPool(threads);

    try {
      var futures =
          List.of(
              executor.submit(
                  () -> {
                    latch.await();
                    TenantContext.set(1L);
                    try {
                      pipeline.dispatchPending(fileId);
                    } finally {
                      TenantContext.clear();
                    }
                    return null;
                  }),
              executor.submit(
                  () -> {
                    latch.await();
                    TenantContext.set(1L);
                    try {
                      pipeline.dispatchPending(fileId);
                    } finally {
                      TenantContext.clear();
                    }
                    return null;
                  }));

      latch.countDown();
      for (var f : futures) f.get();
    } finally {
      executor.shutdown();
    }

    // CAS 로 worker_job 이 정확히 1개만 생성됨
    int jobCount = countJobs(1L, fileId);
    assertThat(jobCount).isEqualTo(1);

    // WorkerClient 도 1회만 호출됨
    verify(workerClient, times(1)).dispatchExtract(any(Long.class), any(), any(), any(Long.class));
  }

  /** 잘못된 토큰으로 콜백 → 401. */
  @Test
  void callback_withWrongToken_isRejected() throws Exception {
    doNothing().when(workerClient).dispatchExtract(any(Long.class), any(), any(), any(Long.class));

    long fileId = createPendingFile(1L);
    TenantContext.set(1L);
    try {
      pipeline.dispatchPending(fileId);
    } finally {
      TenantContext.clear();
    }
    long jobId = latestJobId(1L, fileId);

    mockMvc
        .perform(
            post("/internal/worker/jobs/{id}/result", jobId)
                .header("Authorization", "Internal wrong-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"status\":\"DONE\",\"text\":\"hi\",\"charCount\":2,\"truncated\":false}"))
        .andExpect(status().isUnauthorized());
  }

  /**
   * C1 RLS 회귀 테스트: 신규 테넌트 파일에 대한 콜백이 tenantId 를 포함할 때 TEXT_READY 로 전이되어야 한다.
   *
   * <p>테스트 프로파일의 세션 GUC 기본값은 tenant_id=1 이다. 신규 테넌트(tenant_id!=1) 파일은 TenantContext 없이는 RLS 가 가려
   * CAS 가 0-row no-op 이 된다. 이 테스트는 fix(WorkerCallbackController 가 result.tenantId() 로 TenantContext
   * 복원) 없이는 RED, fix 후에는 GREEN 이어야 한다.
   */
  @Test
  void callback_withTenantId_setsTextReadyInCorrectTenant() throws Exception {
    doNothing().when(workerClient).dispatchExtract(any(Long.class), any(), any(), any(Long.class));

    // 동적 신규 테넌트에 파일 생성 및 EXTRACTING 전이
    long fileId = createPendingFileForTenant2();
    // createPendingFileForTenant2 가 createdTenantIds 에 테넌트 ID 를 등록함
    long dynTenantId = createdTenantIds.get(createdTenantIds.size() - 1);

    TenantContext.set(dynTenantId);
    try {
      pipeline.dispatchPending(fileId);
    } finally {
      TenantContext.clear();
    }

    assertThat(readStatus(dynTenantId, fileId)).isEqualTo("EXTRACTING");
    long jobId = latestJobId(dynTenantId, fileId);

    // 콜백에 dynTenantId 포함 — C1 fix 의 핵심: TenantContext 없이는 신규 테넌트 행이 RLS 로 가려져 no-op
    mockMvc
        .perform(
            post("/internal/worker/jobs/{id}/result", jobId)
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"tenantId\":"
                        + dynTenantId
                        + ",\"status\":\"DONE\",\"text\":\"dynTenant text\",\"charCount\":14,\"truncated\":false}"))
        .andExpect(status().isOk());

    // RLS 픽스 검증: 신규 테넌트 컨텍스트에서 TEXT_READY 상태여야 함
    assertThat(readStatus(dynTenantId, fileId))
        .describedAs("tenantId 콜백 후 신규 테넌트 행이 TEXT_READY 여야 함(C1 픽스 검증)")
        .isEqualTo("TEXT_READY");
    assertThat(readText(dynTenantId, fileId)).isEqualTo("dynTenant text");
  }

  // ── 헬퍼 ──

  /** 지정 테넌트에서 FILE + FILE_EXTRACTION(PENDING) 행을 생성해 file_id 반환. */
  private long createPendingFile(long tenantId) {
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
    Long userId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "ep-test-" + suffix)
                        .set(USER.NAME, "EP Test")
                        .set(USER.EMAIL, "ep-test-" + suffix + "@example.com")
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
                        .set(FILE.ORIGINAL_NAME, "test-" + suffix + ".pdf")
                        .set(FILE.STORED_NAME, "test-" + suffix + ".pdf")
                        .set(FILE.MIME_TYPE, "application/pdf")
                        .set(FILE.SIZE_BYTES, 100L)
                        .set(FILE.STORAGE_PATH, "drive/test-" + suffix + ".pdf")
                        .set(FILE.UPLOADED_BY, userId)
                        .returning(FILE.ID)
                        .fetchOne()
                        .getId();
                dsl.insertInto(FILE_EXTRACTION)
                    .set(FILE_EXTRACTION.FILE_ID, fileId)
                    .set(FILE_EXTRACTION.STATUS, "PENDING")
                    .set(FILE_EXTRACTION.TENANT_ID, tenantId)
                    .execute();
                createdFileIds.add(fileId);
                return fileId;
              });
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /** 지정 테넌트에서 file_extraction 상태 조회. */
  private String readStatus(long tenantId, long fileId) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              s ->
                  dsl.select(FILE_EXTRACTION.STATUS)
                      .from(FILE_EXTRACTION)
                      .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                      .fetchOne(FILE_EXTRACTION.STATUS));
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /** 지정 테넌트에서 file_extraction 텍스트 조회. */
  private String readText(long tenantId, long fileId) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              s ->
                  dsl.select(FILE_EXTRACTION.EXTRACTED_TEXT)
                      .from(FILE_EXTRACTION)
                      .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                      .fetchOne(FILE_EXTRACTION.EXTRACTED_TEXT));
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /** 지정 테넌트에서 file_extraction char_count 조회. */
  private Integer readCharCount(long tenantId, long fileId) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              s ->
                  dsl.select(FILE_EXTRACTION.CHAR_COUNT)
                      .from(FILE_EXTRACTION)
                      .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                      .fetchOne(FILE_EXTRACTION.CHAR_COUNT));
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /** 지정 fileId 의 worker_job id 를 조회(가장 최근). PostgreSQL JSONB @> 연산자로 정규화된 형식도 매칭. */
  private long latestJobId(long tenantId, long fileId) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              s ->
                  dsl.select(WORKER_JOB.ID)
                      .from(WORKER_JOB)
                      .where(
                          WORKER_JOB.PARAMS.contains(JSONB.valueOf("{\"fileId\":" + fileId + "}")))
                      .orderBy(WORKER_JOB.ID.desc())
                      .limit(1)
                      .fetchOne(WORKER_JOB.ID));
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /**
   * C1 회귀 테스트용: 신규 테넌트를 생성하고 해당 테넌트의 PENDING FILE + FILE_EXTRACTION 을 생성. 생성된 테넌트 ID 를
   * createdTenantId 필드에 저장(정리용).
   *
   * <p>테넌트 생성 후 해당 테넌트 컨텍스트에서 파일을 삽입한다. 테스트 DB 에 tenant-2 가 없을 수 있으므로 동적으로 생성.
   */
  private long createPendingFileForTenant2() {
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
    // USER 는 RLS 비대상 — 트랜잭션 없이 삽입 가능(정리는 createdUserIds)
    Long userId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "ep2-test-" + suffix)
                        .set(USER.NAME, "EP2 Test")
                        .set(USER.EMAIL, "ep2-test-" + suffix + "@example.com")
                        .set(USER.KIND, "HUMAN")
                        .returning(USER.ID)
                        .fetchOne()
                        .getId());
    createdUserIds.add(userId);

    // 테넌트2 동적 생성: 테스트 DB 에 id=2 가 없을 수 있으므로 auto-id 로 생성
    Long tenantId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(TENANT)
                        .set(TENANT.NAME, "ep2-tenant-" + suffix)
                        .set(TENANT.SLUG, "ep2-tenant-" + suffix)
                        .returning(TENANT.ID)
                        .fetchOne()
                        .getId());
    createdTenantIds.add(tenantId);

    // 해당 테넌트 컨텍스트에서 FILE + FILE_EXTRACTION(PENDING) 생성
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              s -> {
                long fileId =
                    dsl.insertInto(FILE)
                        .set(FILE.ORIGINAL_NAME, "ep2-" + suffix + ".pdf")
                        .set(FILE.STORED_NAME, "ep2-" + suffix + ".pdf")
                        .set(FILE.MIME_TYPE, "application/pdf")
                        .set(FILE.SIZE_BYTES, 100L)
                        .set(FILE.STORAGE_PATH, "drive/ep2-" + suffix + ".pdf")
                        .set(FILE.UPLOADED_BY, userId)
                        .returning(FILE.ID)
                        .fetchOne()
                        .getId();
                dsl.insertInto(FILE_EXTRACTION)
                    .set(FILE_EXTRACTION.FILE_ID, fileId)
                    .set(FILE_EXTRACTION.STATUS, "PENDING")
                    .set(FILE_EXTRACTION.TENANT_ID, tenantId)
                    .execute();
                createdFileIdsTenant2.add(fileId);
                return fileId;
              });
    } finally {
      TenantContext.clear();
    }
  }

  /** 지정 fileId 로 생성된 worker_job 개수. */
  private int countJobs(long tenantId, long fileId) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              s ->
                  dsl.fetchCount(
                      WORKER_JOB,
                      WORKER_JOB.PARAMS.contains(JSONB.valueOf("{\"fileId\":" + fileId + "}"))));
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }
}
