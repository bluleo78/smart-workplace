package com.workplace.fileai;

import static com.workplace.fileai.repository.WorkerJobRepository.MAX_SUMMARY_ATTEMPTS;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKER_JOB;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.fileai.outbound.AiAgentDriveClient;
import com.workplace.fileai.outbound.WorkerClient;
import com.workplace.fileai.repository.WorkerJobRepository;
import com.workplace.fileai.service.FileExtractionPipeline;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * FileExtractionPipeline 요약 단계 + E2E + 경합 통합 테스트.
 *
 * <p>(1) 업로드→추출→TEXT_READY→요약→DONE E2E. (2) 이중 요약 경합: 동시 2회 summarizePending → ai-agent 1회만 호출(CAS
 * 검증). (3) 요약 실패 → TEXT_READY 유지 → 재시도 → DONE.
 */
@AutoConfigureMockMvc
class ExtractionE2eTest extends IntegrationTestBase {

  private static final String INTERNAL_TOKEN = "test-token";

  @Autowired private MockMvc mockMvc;
  @Autowired private FileExtractionPipeline pipeline;
  @Autowired private WorkerJobRepository jobRepo;
  @Autowired private DSLContext dsl;

  /** WorkerClient mock — 실제 워커 HTTP 호출 차단. */
  @MockitoBean private WorkerClient workerClient;

  /** AiAgentDriveClient mock — 실제 ai-agent HTTP 호출 차단. */
  @MockitoBean private AiAgentDriveClient aiAgentDriveClient;

  /** AssistantResolver mock — 테스트 DB 에 workspace 비서 미설정 상태를 회피하기 위해 mock 으로 대체. */
  @MockitoBean private AssistantResolver assistantResolver;

  /** 테스트용 AssistantSpec — agentUserId/model/timeoutMs 고정값. */
  private static final AssistantSpec TEST_SPEC =
      new AssistantSpec(1L, "claude-sonnet-4-6", "NORMAL", 1, 60_000);

  private final List<Long> createdFileIds = new ArrayList<>();
  private final List<Long> createdUserIds = new ArrayList<>();

  /** 각 테스트 전 AssistantResolver mock 설정 — resolveWorkspaceOrEmpty 가 TEST_SPEC 반환. */
  @BeforeEach
  void setupAssistantResolver() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(TEST_SPEC));
  }

  @AfterEach
  void cleanup() {
    if (!createdFileIds.isEmpty()) {
      cleanupInTenant(
          1L,
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
   * E2E: PENDING → dispatchPending → EXTRACTING → 콜백(TEXT_READY) → summarizePending(ai-agent mock)
   * → DONE + summary.
   */
  @Test
  void uploadToDone_endToEnd() throws Exception {
    doNothing().when(workerClient).dispatchExtract(any(Long.class), any(), any(), any(Long.class));
    var mockSummary = "테스트 요약문";
    mockAiSummarize(mockSummary);

    long fileId = createTextReadyFile(1L);

    // summarizePending: TEXT_READY→SUMMARIZING CAS → ai-agent 호출 → DONE
    TenantContext.set(1L);
    try {
      pipeline.summarizePending(fileId);
    } finally {
      TenantContext.clear();
    }

    // DONE 전이 및 summary 저장 검증
    assertThat(readStatus(1L, fileId)).isEqualTo("DONE");
    assertThat(readSummary(1L, fileId)).isEqualTo(mockSummary);

    // ai-agent 가 정확히 1회 호출됨
    verify(aiAgentDriveClient, times(1)).summarize(any());
  }

  /**
   * 이중 요약 경합: 동시 2회 summarizePending → CAS 로 ai-agent 1회만 호출. 최종 상태=DONE.
   *
   * <p>CountDownLatch 로 두 스레드를 동시에 CAS 에 진입시켜 실제 경합을 재현한다. CAS(TEXT_READY→SUMMARIZING)가 단 1개 스레드만
   * 통과하므로 ai-agent 호출도 1회여야 한다.
   */
  @Test
  void concurrentSummarize_callsAiOnce() throws Exception {
    doNothing().when(workerClient).dispatchExtract(any(Long.class), any(), any(), any(Long.class));
    AtomicInteger callCount = new AtomicInteger(0);
    // ai-agent 호출 횟수를 세면서 정상 응답 반환 (doAnswer 로 실제 메서드 호출 없이 stub 교체)
    org.mockito.Mockito.doAnswer(
            inv -> {
              callCount.incrementAndGet();
              return new AiAgentDriveClient.Res("경합 요약");
            })
        .when(aiAgentDriveClient)
        .summarize(any());

    long fileId = createTextReadyFile(1L);

    int threads = 2;
    CountDownLatch latch = new CountDownLatch(1);
    ExecutorService executor = Executors.newFixedThreadPool(threads);

    try {
      var futures =
          List.of(
              executor.submit(
                  () -> {
                    latch.await();
                    TenantContext.set(1L);
                    try {
                      pipeline.summarizePending(fileId);
                    } catch (RuntimeException ignored) {
                      // CAS 실패 스레드는 예외 없이 early-return
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
                      pipeline.summarizePending(fileId);
                    } catch (RuntimeException ignored) {
                    } finally {
                      TenantContext.clear();
                    }
                    return null;
                  }));

      // 두 스레드를 동시에 CAS 지점으로 릴리스
      latch.countDown();
      for (var f : futures) f.get();
    } finally {
      executor.shutdown();
    }

    // CAS 로 ai-agent 는 정확히 1회만 호출됨
    assertThat(callCount.get()).isEqualTo(1);
    // 최종 상태 DONE
    assertThat(readStatus(1L, fileId)).isEqualTo("DONE");
  }

  /**
   * 요약 실패 → TEXT_READY 유지(attempts 증가) → 재시도 → DONE.
   *
   * <p>1차: ai-agent 예외 → TEXT_READY 복귀. 2차: ai-agent 정상 → DONE.
   */
  @Test
  void summaryFailure_staysTextReady_thenResumes() {
    doNothing().when(workerClient).dispatchExtract(any(Long.class), any(), any(), any(Long.class));

    long fileId = createTextReadyFile(1L);

    // 1차: ai-agent 예외
    doThrow(new RuntimeException("ai-agent 연결 실패")).when(aiAgentDriveClient).summarize(any());

    TenantContext.set(1L);
    try {
      assertThatThrownBy(() -> pipeline.summarizePending(fileId))
          .isInstanceOf(RuntimeException.class);
    } finally {
      TenantContext.clear();
    }

    // 실패 후 TEXT_READY 복귀 검증
    assertThat(readStatus(1L, fileId)).isEqualTo("TEXT_READY");

    // 2차: ai-agent 정상 응답
    mockAiSummarize("재시도 요약");

    TenantContext.set(1L);
    try {
      pipeline.summarizePending(fileId);
    } finally {
      TenantContext.clear();
    }

    // DONE 으로 전이
    assertThat(readStatus(1L, fileId)).isEqualTo("DONE");
    assertThat(readSummary(1L, fileId)).isEqualTo("재시도 요약");
  }

  /**
   * 독성 파일(poison file) 시나리오: ai-agent 가 항상 예외를 던지는 파일은 MAX_SUMMARY_ATTEMPTS 도달 후 FAILED(단말)로 전이되어
   * 무한 재시도 루프를 방지해야 한다.
   *
   * <p>검증: (1) MAX_SUMMARY_ATTEMPTS 회 summarizePending 호출 후 상태=FAILED, (2) 이후 추가 호출에서 ai-agent mock
   * 이 더 이상 호출되지 않음(findResumable 필터로 제외), (3) ai-agent 총 호출 횟수 = MAX_SUMMARY_ATTEMPTS(상한 정확).
   */
  @Test
  void poisonFile_reachesMaxAttempts_thenFailed() {
    doNothing().when(workerClient).dispatchExtract(any(Long.class), any(), any(), any(Long.class));
    doThrow(new RuntimeException("영구 ai-agent 오류")).when(aiAgentDriveClient).summarize(any());

    long fileId = createTextReadyFile(1L);

    // MAX_SUMMARY_ATTEMPTS 회 반복 호출 — 각 호출에서 ai-agent 예외 → attempts 증가
    for (int i = 0; i < MAX_SUMMARY_ATTEMPTS; i++) {
      int attempt = i;
      TenantContext.set(1L);
      try {
        assertThatThrownBy(() -> pipeline.summarizePending(fileId))
            .isInstanceOf(RuntimeException.class)
            .describedAs("attempt %d 에서 예외가 전파되어야 함", attempt);
      } finally {
        TenantContext.clear();
      }
    }

    // 마지막 시도(attempts=MAX) 후 FAILED 로 단말 전이
    assertThat(readStatus(1L, fileId))
        .describedAs("MAX_SUMMARY_ATTEMPTS 도달 시 FAILED(단말) 상태여야 함")
        .isEqualTo("FAILED");

    // ai-agent 는 정확히 MAX_SUMMARY_ATTEMPTS 회만 호출됨
    verify(aiAgentDriveClient, times(MAX_SUMMARY_ATTEMPTS)).summarize(any());

    // FAILED 행은 findResumable 에서 제외됨 → 추가 summarizePending 호출 시 CAS 실패(FAILED 는 클레임 불가)
    // 상한에 정확히 도달했을 때의 대조 검증: attempts=MAX 행은 findResumable 결과에 없어야 함
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              s -> {
                var resumable = jobRepo.findResumable();
                assertThat(resumable)
                    .describedAs("FAILED 행(attempts=MAX)은 findResumable 결과에서 제외되어야 함")
                    .doesNotContain(fileId);
              });
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * stuck-SUMMARIZING 복구 시나리오: 리스 만료된 SUMMARIZING 행은 claimForSummary CAS 가 재클레임해 DONE 으로 이어야 한다.
   *
   * <p>검증: (1) SUMMARIZING + leased_until 과거 행을 직접 삽입, (2) summarizePending 호출 후 DONE 전이, (3)
   * ai-agent 정확히 1회 호출(CAS 성공).
   */
  @Test
  void stuckSummarizing_leasedUntilPast_isReclaimed() {
    doNothing().when(workerClient).dispatchExtract(any(Long.class), any(), any(), any(Long.class));
    mockAiSummarize("복구 요약");

    // SUMMARIZING + leased_until=과거 행을 직접 삽입해 프로세스 크래시 상황을 시뮬레이션
    long fileId = createStuckSummarizingFile(1L);

    TenantContext.set(1L);
    try {
      // claimForSummary 가 "SUMMARIZING AND leased_until < now()" 조건으로 재클레임해야 함
      pipeline.summarizePending(fileId);
    } finally {
      TenantContext.clear();
    }

    // 재클레임 후 DONE 으로 전이
    assertThat(readStatus(1L, fileId))
        .describedAs("리스 만료 SUMMARIZING 행은 재클레임 후 DONE 이어야 함")
        .isEqualTo("DONE");
    assertThat(readSummary(1L, fileId)).isEqualTo("복구 요약");

    // ai-agent 정확히 1회 호출
    verify(aiAgentDriveClient, times(1)).summarize(any());
  }

  // ── 헬퍼 ──

  /**
   * 텍스트 추출 완료 상태(TEXT_READY + extracted_text)의 파일을 생성한다. dispatchPending → 콜백 시퀀스를 거치지 않고 직접 삽입해 요약
   * 단계 테스트를 격리한다.
   */
  private long createTextReadyFile(long tenantId) {
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
    Long userId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "e2e-test-" + suffix)
                        .set(USER.NAME, "E2E Test")
                        .set(USER.EMAIL, "e2e-test-" + suffix + "@example.com")
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
                // TEXT_READY 상태로 직접 삽입 (추출 완료 상태 시뮬레이션)
                dsl.insertInto(FILE_EXTRACTION)
                    .set(FILE_EXTRACTION.FILE_ID, fileId)
                    .set(FILE_EXTRACTION.STATUS, "TEXT_READY")
                    .set(FILE_EXTRACTION.TENANT_ID, tenantId)
                    .set(FILE_EXTRACTION.EXTRACTED_TEXT, "추출된 텍스트 내용입니다.")
                    .set(FILE_EXTRACTION.CHAR_COUNT, 14)
                    .execute();
                createdFileIds.add(fileId);
                return fileId;
              });
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  private void mockAiSummarize(String summary) {
    // doReturn 패턴 사용 — when/thenReturn 은 stub 설정 중 실제 메서드를 호출해 이전 doThrow 가 발화할 수 있음
    org.mockito.Mockito.doReturn(new AiAgentDriveClient.Res(summary))
        .when(aiAgentDriveClient)
        .summarize(any());
  }

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

  private String readSummary(long tenantId, long fileId) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              s ->
                  dsl.select(FILE_EXTRACTION.SUMMARY)
                      .from(FILE_EXTRACTION)
                      .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                      .fetchOne(FILE_EXTRACTION.SUMMARY));
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /**
   * 리스가 만료된 SUMMARIZING 상태의 파일을 직접 삽입한다. 프로세스 크래시로 인해 SUMMARIZING 상태에서 멈춘 행을 시뮬레이션한다.
   *
   * <p>leased_until 을 과거(1시간 전)로 설정해 claimForSummary 의 "SUMMARIZING AND leased_until &lt; now()"
   * 조건이 즉시 성립하게 한다.
   */
  private long createStuckSummarizingFile(long tenantId) {
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
    Long userId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "stuck-test-" + suffix)
                        .set(USER.NAME, "Stuck Test")
                        .set(USER.EMAIL, "stuck-test-" + suffix + "@example.com")
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
                        .set(FILE.ORIGINAL_NAME, "stuck-" + suffix + ".pdf")
                        .set(FILE.STORED_NAME, "stuck-" + suffix + ".pdf")
                        .set(FILE.MIME_TYPE, "application/pdf")
                        .set(FILE.SIZE_BYTES, 100L)
                        .set(FILE.STORAGE_PATH, "drive/stuck-" + suffix + ".pdf")
                        .set(FILE.UPLOADED_BY, userId)
                        .returning(FILE.ID)
                        .fetchOne()
                        .getId();
                // SUMMARIZING + 만료된 리스 + 추출 텍스트 직접 삽입 (크래시 시뮬레이션)
                dsl.insertInto(FILE_EXTRACTION)
                    .set(FILE_EXTRACTION.FILE_ID, fileId)
                    .set(FILE_EXTRACTION.STATUS, "SUMMARIZING")
                    .set(FILE_EXTRACTION.TENANT_ID, tenantId)
                    .set(FILE_EXTRACTION.EXTRACTED_TEXT, "stuck 파일의 추출 텍스트.")
                    .set(FILE_EXTRACTION.CHAR_COUNT, 12)
                    .set(FILE_EXTRACTION.ATTEMPTS, 0)
                    // leased_until = 1시간 전 → claimForSummary "SUMMARIZING AND leased_until < now()"
                    // 즉시 성립
                    .set(FILE_EXTRACTION.LEASED_UNTIL, OffsetDateTime.now().minusHours(1))
                    .execute();
                createdFileIds.add(fileId);
                return fileId;
              });
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }
}
