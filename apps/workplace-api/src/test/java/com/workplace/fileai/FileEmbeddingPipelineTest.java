package com.workplace.fileai;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKER_JOB;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doNothing;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * FileEmbeddingPipeline + WorkerJobRepository 임베딩 경로 통합 테스트.
 *
 * <p>embed worker_job 생성, hasPendingEmbedJob CAS, applyEmbedResult 멱등, findEmbeddable 독성 루프 가드, 콜백
 * 엔드포인트 C1 RLS 회귀를 검증한다.
 */
@AutoConfigureMockMvc
@TestPropertySource(properties = "workplace.worker.enabled=true")
class FileEmbeddingPipelineTest extends IntegrationTestBase {

  /** 테스트 프로파일 workplace.worker.internal-token 값. */
  private static final String INTERNAL_TOKEN = "test-token";

  /** 테넌트 1 ID (기본 테스트 테넌트). */
  private static final long TENANT_1 = 1L;

  @Autowired private MockMvc mockMvc;
  @Autowired private WorkerJobRepository repo;
  @Autowired private DSLContext dsl;

  /** WorkerClient mock — 실제 워커 HTTP 호출 차단. */
  @MockitoBean private WorkerClient workerClient;

  /** 테스트에서 삽입한 file_id 목록 — @AfterEach 정리용. */
  private final List<Long> createdFileIds = new ArrayList<>();

  /** 테스트에서 생성한 user_id 목록. */
  private final List<Long> createdUserIds = new ArrayList<>();

  /** 동적 테넌트의 파일 ID 목록 — 해당 테넌트 컨텍스트로 정리. */
  private final List<Long> createdFileIdsDynTenant = new ArrayList<>();

  /** 동적 생성 테넌트 ID 목록. */
  private final List<Long> createdTenantIds = new ArrayList<>();

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
    if (!createdFileIdsDynTenant.isEmpty() && !createdTenantIds.isEmpty()) {
      for (long tenantId : createdTenantIds) {
        cleanupInTenant(
            tenantId,
            () -> {
              for (long fileId : createdFileIdsDynTenant) {
                dsl.deleteFrom(WORKER_JOB)
                    .where(WORKER_JOB.PARAMS.contains(JSONB.valueOf("{\"fileId\":" + fileId + "}")))
                    .execute();
              }
              dsl.deleteFrom(FILE_EXTRACTION)
                  .where(FILE_EXTRACTION.FILE_ID.in(createdFileIdsDynTenant))
                  .execute();
              dsl.deleteFrom(FILE).where(FILE.ID.in(createdFileIdsDynTenant)).execute();
            });
      }
      createdFileIdsDynTenant.clear();
    }
    createdTenantIds.clear();
    if (!createdUserIds.isEmpty()) {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              s -> dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute());
      createdUserIds.clear();
    }
  }

  /**
   * embed 잡 생성 + hasPendingEmbedJob 이 lease 유효 기간 동안 true 를 반환하는지 검증.
   *
   * <p>중복 디스패치 가드(CAS) 의 핵심 — lease 만료 전에는 재디스패치를 막는다.
   */
  @Test
  void createEmbedJob_sets_lease_and_hasPendingEmbedJob_true_until_expiry() {
    long fileId = seedDoneExtraction(TENANT_1);
    // embed 잡 생성 (tenantId GUC 필요 — WORKER_JOB FORCE RLS)
    long jobId = runAsTenant(TENANT_1, () -> repo.createEmbedJob(TENANT_1, fileId, "본문 텍스트"));
    assertThat(jobId).isPositive();
    // lease 미만료 → 재디스패치 가드 true(중복 디스패치 차단)
    assertThat(runAsTenant(TENANT_1, () -> repo.hasPendingEmbedJob(fileId))).isTrue();
  }

  /**
   * applyEmbedResult 가 멱등임을 검증.
   *
   * <p>첫 호출: embedding IS NULL → UPDATE 1행. 두 번째 호출: embedding 이미 SET → UPDATE 0행(멱등).
   */
  @Test
  void applyEmbedResult_is_idempotent_and_sets_vector() {
    long fileId = seedDoneExtraction(TENANT_1);
    runAsTenant(TENANT_1, () -> repo.createEmbedJob(TENANT_1, fileId, "본문"));
    // 첫 번째 UPDATE → 1행
    int n1 = runAsTenant(TENANT_1, () -> repo.applyEmbedResult(fileId, vec1024Literal()));
    // 두 번째 UPDATE → 0행(embedding IS NULL 조건 불만족)
    int n2 = runAsTenant(TENANT_1, () -> repo.applyEmbedResult(fileId, vec1024Literal()));
    assertThat(n1).isEqualTo(1);
    assertThat(n2).isZero();
  }

  /**
   * findEmbeddable 독성 루프 가드: MAX_EMBED_ATTEMPTS 회 FAILED embed 잡이 쌓인 파일은 제외.
   *
   * <p>#525 추출 경로에서 막은 독성 루프가 임베딩 경로로 재발하지 않도록 한다. 이 테스트가 없으면 독성 루프가 silently 재발한다.
   */
  @Test
  void findEmbeddable_excludes_files_with_max_failed_embed_jobs() {
    // DONE + embedding NULL + FAILED 잡 3개(= MAX_EMBED_ATTEMPTS) → 제외되어야 함
    long poisonFileId = seedDoneExtraction(TENANT_1);
    // 3회 FAILED embed 잡 시드
    for (int i = 0; i < 3; i++) {
      long jobId = runAsTenant(TENANT_1, () -> repo.createEmbedJob(TENANT_1, poisonFileId, "txt"));
      runAsTenant(
          TENANT_1,
          () -> {
            repo.markEmbedJobFailed(jobId, "error-" + jobId);
            return null;
          });
    }
    List<Long> embeddable = runAsTenant(TENANT_1, () -> repo.findEmbeddable(100));
    assertThat(embeddable).doesNotContain(poisonFileId);
  }

  /**
   * findEmbeddable 대칭 케이스: FAILED 잡이 MAX_EMBED_ATTEMPTS 미만이면 포함.
   *
   * <p>독성 루프 가드가 정상 재시도를 막지 않음을 검증.
   */
  @Test
  void findEmbeddable_includes_files_below_max_failed_embed_jobs() {
    // DONE + embedding NULL + FAILED 잡 2개(< MAX_EMBED_ATTEMPTS=3) → 포함되어야 함
    long fileId = seedDoneExtraction(TENANT_1);
    for (int i = 0; i < 2; i++) {
      long jobId = runAsTenant(TENANT_1, () -> repo.createEmbedJob(TENANT_1, fileId, "txt"));
      runAsTenant(
          TENANT_1,
          () -> {
            repo.markEmbedJobFailed(jobId, "err");
            return null;
          });
    }
    List<Long> embeddable = runAsTenant(TENANT_1, () -> repo.findEmbeddable(100));
    assertThat(embeddable).contains(fileId);
  }

  /**
   * C1 RLS 회귀 테스트: embed-result 콜백이 tenantId 를 포함할 때 embedding 이 적용되어야 함.
   *
   * <p>이 테스트는 WorkerCallbackController.embedResult 가 TenantContext.set(result.tenantId()) 를 호출하지
   * 않으면 RED. 테스트 프로파일의 세션 GUC 기본값은 tenant_id=1 이다. 신규 동적 테넌트(id != 1) 파일은 TenantContext 없이는 RLS 가
   * 가려 UPDATE 가 0행이 된다(fail-closed). 이 테스트는 Controller fix 없이는 RED, fix 후에는 GREEN 이어야 한다.
   *
   * <p>psql -U app(소유자)는 RLS 우회(FORCE off) → "전원 권한" 오진 함정(#492 교훈). 이 테스트는 app_tenant 롤 + RLS 실경로를
   * 탄다.
   */
  @Test
  void embedResult_callback_with_tenantId_sets_embedding_in_correct_tenant() throws Exception {
    doNothing().when(workerClient).dispatchEmbed(anyLong(), anyString(), anyLong());

    // 동적 신규 테넌트 생성 + DONE 파일 시드
    long dynTenantId = createDynTenant();
    long fileId = seedDoneExtractionInTenant(dynTenantId);
    // embed 잡 생성 (콜백 수신용 jobId 필요)
    long jobId = runAsTenant(dynTenantId, () -> repo.createEmbedJob(dynTenantId, fileId, "본문"));

    // POST embed-result — 테스트에 TenantContext 미설정. Controller 가 tenantId 로 set 해야 함.
    String vec = vec1024Literal();
    String body =
        "{\"tenantId\":"
            + dynTenantId
            + ",\"dimensions\":1024,\"embedding\":["
            + "0.0".repeat(1)
            + ","
            + String.join(",", java.util.Collections.nCopies(1023, "0.0"))
            + "]}";
    mockMvc
        .perform(
            post("/internal/worker/jobs/{id}/embed-result", jobId)
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk());

    // 동적 테넌트 컨텍스트에서 embedding 이 non-null 이어야 함(C1 fix 검증)
    Object embedding =
        runAsTenant(
            dynTenantId,
            () ->
                new TransactionTemplate(txManager)
                    .execute(
                        s ->
                            dsl.select(FILE_EXTRACTION.EMBEDDING)
                                .from(FILE_EXTRACTION)
                                .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                                .fetchOne(FILE_EXTRACTION.EMBEDDING)));
    assertThat(embedding).describedAs("tenantId 콜백 후 임베딩이 저장되어야 함(C1 RLS fix 검증)").isNotNull();
  }

  /** embed-result 잘못된 토큰 → 401. */
  @Test
  void embedResult_callback_with_wrong_token_is_rejected() throws Exception {
    long fileId = seedDoneExtraction(TENANT_1);
    long jobId = runAsTenant(TENANT_1, () -> repo.createEmbedJob(TENANT_1, fileId, "본문"));
    mockMvc
        .perform(
            post("/internal/worker/jobs/{id}/embed-result", jobId)
                .header("Authorization", "Internal wrong-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"tenantId\":1,\"dimensions\":1024,\"embedding\":["
                        + String.join(",", java.util.Collections.nCopies(1024, "0.0"))
                        + "]}"))
        .andExpect(status().isUnauthorized());
  }

  /** embed-result tenantId 없으면 400. */
  @Test
  void embedResult_callback_without_tenantId_is_bad_request() throws Exception {
    long fileId = seedDoneExtraction(TENANT_1);
    long jobId = runAsTenant(TENANT_1, () -> repo.createEmbedJob(TENANT_1, fileId, "본문"));
    mockMvc
        .perform(
            post("/internal/worker/jobs/{id}/embed-result", jobId)
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"dimensions\":1024,\"embedding\":["
                        + String.join(",", java.util.Collections.nCopies(1024, "0.0"))
                        + "]}"))
        .andExpect(status().isBadRequest());
  }

  /**
   * 차원 불일치 콜백: markEmbedJobFailed 가 호출되고 embedding 은 저장되지 않아야 함.
   *
   * <p>워커가 384차원 벡터를 보내면(기대값 1024), pgvector UPDATE 전에 검증해 FAILED 로 마킹한다. 포이즌 루프 가드(FAILED 횟수 집계)가
   * 정상 동작하려면 이 경로가 FAILED 를 기록해야 한다.
   */
  @Test
  void applyEmbedResult_dimension_mismatch_marks_job_failed_and_skips_update() throws Exception {
    long fileId = seedDoneExtraction(TENANT_1);
    long jobId = runAsTenant(TENANT_1, () -> repo.createEmbedJob(TENANT_1, fileId, "본문"));

    // 384차원 벡터로 콜백(기대값 1024) — 차원 불일치
    int wrongDim = 384;
    String vec384 = "[" + "0.0,".repeat(wrongDim - 1) + "0.0]";
    String body =
        "{\"tenantId\":"
            + TENANT_1
            + ",\"dimensions\":"
            + wrongDim
            + ",\"embedding\":"
            + vec384
            + "}";
    mockMvc
        .perform(
            post("/internal/worker/jobs/{id}/embed-result", jobId)
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk());

    // embedding 은 저장되지 않아야 함(차원 불일치)
    Object embedding =
        runAsTenant(
            TENANT_1,
            () ->
                new TransactionTemplate(txManager)
                    .execute(
                        s ->
                            dsl.select(FILE_EXTRACTION.EMBEDDING)
                                .from(FILE_EXTRACTION)
                                .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                                .fetchOne(FILE_EXTRACTION.EMBEDDING)));
    assertThat(embedding).describedAs("차원 불일치 시 embedding 이 저장되면 안 됨").isNull();

    // worker_job 이 FAILED 상태여야 함(포이즌 루프 가드가 집계할 수 있도록)
    String jobStatus =
        runAsTenant(
            TENANT_1,
            () ->
                new TransactionTemplate(txManager)
                    .execute(
                        s ->
                            dsl.select(WORKER_JOB.STATUS)
                                .from(WORKER_JOB)
                                .where(WORKER_JOB.ID.eq(jobId))
                                .fetchOne(WORKER_JOB.STATUS)));
    assertThat(jobStatus).describedAs("차원 불일치 시 worker_job 이 FAILED 여야 함").isEqualTo("FAILED");
  }

  // ── 헬퍼 ──

  /**
   * 지정 테넌트에 FILE + FILE_EXTRACTION(DONE) 행을 생성하고 file_id 반환.
   *
   * <p>임베딩 경로 테스트용 — STATUS=DONE, embedding=NULL, extracted_text 있음.
   */
  private long seedDoneExtraction(long tenantId) {
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
    Long userId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "emb-test-" + suffix)
                        .set(USER.NAME, "Embed Test")
                        .set(USER.EMAIL, "emb-test-" + suffix + "@example.com")
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
                        .set(FILE.ORIGINAL_NAME, "emb-test-" + suffix + ".pdf")
                        .set(FILE.STORED_NAME, "emb-test-" + suffix + ".pdf")
                        .set(FILE.MIME_TYPE, "application/pdf")
                        .set(FILE.SIZE_BYTES, 100L)
                        .set(FILE.STORAGE_PATH, "drive/emb-test-" + suffix + ".pdf")
                        .set(FILE.UPLOADED_BY, userId)
                        .returning(FILE.ID)
                        .fetchOne()
                        .getId();
                dsl.insertInto(FILE_EXTRACTION)
                    .set(FILE_EXTRACTION.FILE_ID, fileId)
                    .set(FILE_EXTRACTION.STATUS, "DONE")
                    .set(FILE_EXTRACTION.EXTRACTED_TEXT, "테스트 본문 텍스트")
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

  /** 동적 테넌트에 DONE FILE_EXTRACTION 시드. createdFileIdsDynTenant 에 등록. */
  private long seedDoneExtractionInTenant(long tenantId) {
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
    Long userId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "emb-dyn-" + suffix)
                        .set(USER.NAME, "Embed Dyn")
                        .set(USER.EMAIL, "emb-dyn-" + suffix + "@example.com")
                        .set(USER.KIND, "HUMAN")
                        .returning(USER.ID)
                        .fetchOne()
                        .getId());
    createdUserIds.add(userId);

    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              s -> {
                long fileId =
                    dsl.insertInto(FILE)
                        .set(FILE.ORIGINAL_NAME, "emb-dyn-" + suffix + ".pdf")
                        .set(FILE.STORED_NAME, "emb-dyn-" + suffix + ".pdf")
                        .set(FILE.MIME_TYPE, "application/pdf")
                        .set(FILE.SIZE_BYTES, 100L)
                        .set(FILE.STORAGE_PATH, "drive/emb-dyn-" + suffix + ".pdf")
                        .set(FILE.UPLOADED_BY, userId)
                        .returning(FILE.ID)
                        .fetchOne()
                        .getId();
                dsl.insertInto(FILE_EXTRACTION)
                    .set(FILE_EXTRACTION.FILE_ID, fileId)
                    .set(FILE_EXTRACTION.STATUS, "DONE")
                    .set(FILE_EXTRACTION.EXTRACTED_TEXT, "동적 테넌트 본문")
                    .set(FILE_EXTRACTION.TENANT_ID, tenantId)
                    .execute();
                createdFileIdsDynTenant.add(fileId);
                return fileId;
              });
    } finally {
      TenantContext.clear();
    }
  }

  /** 동적 테넌트를 생성하고 tenantId 를 반환. createdTenantIds 에 등록. */
  private long createDynTenant() {
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
    Long tenantId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(TENANT)
                        .set(TENANT.NAME, "emb-tenant-" + suffix)
                        .set(TENANT.SLUG, "emb-tenant-" + suffix)
                        .returning(TENANT.ID)
                        .fetchOne()
                        .getId());
    createdTenantIds.add(tenantId);
    return tenantId;
  }

  /**
   * 지정 테넌트 컨텍스트에서 Callable 을 실행하고 결과를 반환한다.
   *
   * <p>TenantContext 를 설정하고 txTemplate 으로 트랜잭션을 열어 GUC 가 주입되도록 한다. RLS-safe 조회/변경에 사용.
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

  /**
   * 1024차원 zero 벡터 리터럴. vector(1024) 컬럼 캐스트 경로 검증용.
   *
   * <p>차원 불일치 시 PostgreSQL "vector dimensions don't match" 오류 발생 → 이 헬퍼로 통일.
   */
  private String vec1024Literal() {
    return "[" + "0.0,".repeat(1023) + "0.0]";
  }
}
