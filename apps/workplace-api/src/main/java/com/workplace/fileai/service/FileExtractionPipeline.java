package com.workplace.fileai.service;

import static com.workplace.fileai.repository.WorkerJobRepository.MAX_SUMMARY_ATTEMPTS;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.fileai.event.FileExtractionDoneEvent;
import com.workplace.fileai.outbound.AiAgentDriveClient;
import com.workplace.fileai.outbound.WorkerClient;
import com.workplace.fileai.outbound.WorkerProperties;
import com.workplace.fileai.repository.WorkerJobRepository;
import com.workplace.fileai.repository.WorkerJobRepository.SummaryContext;
import com.workplace.global.tenant.TenantContext;
import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.jooq.DSLContext;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 파일 콘텐츠 파이프라인 단계 전이 오케스트레이션(CAS).
 *
 * <p>dispatchPending: PENDING→EXTRACTING CAS 성공 시에만 worker_job 생성 + 워커 push(이중 잡 방지).
 * applyExtractResult: worker 콜백 수신 시 worker_job DONE + file_extraction EXTRACTING→TEXT_READY(또는
 * SKIPPED) 전이. EXTRACTING 이 아니면 무시(스테일 콜백 가드). summarizePending: TEXT_READY→SUMMARIZING CAS →
 * ai-agent 요약 호출(트랜잭션 외부) → DONE. 실패 시 TEXT_READY 복귀(재시도 가능).
 */
@Slf4j
@Service
public class FileExtractionPipeline {

  /**
   * 워커 추출 결과 페이로드 — 콜백 컨트롤러와 공유(controller→service 단방향).
   *
   * <p>tenantId 는 디스패치 시 워커에 전달한 값을 그대로 에코(round-trip). 콜백 컨트롤러가 TenantContext 복원에 사용.
   */
  public record ExtractResult(
      Long tenantId,
      String status,
      String text,
      Integer charCount,
      String lang,
      Boolean truncated,
      String error) {}

  /** ai-agent 요약 단발 호출은 turn 1 고정. */
  private static final int MAX_TURNS = 1;

  private final WorkerJobRepository jobs;
  private final WorkerClient worker;
  private final WorkerProperties props;
  private final AiAgentDriveClient driveClient;
  private final AssistantResolver assistantResolver;
  private final DSLContext dsl;

  /**
   * 짧은-트랜잭션용 TransactionTemplate. @Primary TenantAwareTransactionManager 로 구성돼 트랜잭션 진입 시 RLS
   * GUC(app.tenant_id) 가 주입된다.
   */
  private final TransactionTemplate txTemplate;

  /**
   * 요약 nudge 전용 executor. applyExtractResult afterCommit 에서 summarizePending 을 백그라운드로 실행.
   * TenantContext 를 전파하는 데코레이터를 사용한다.
   */
  private final Executor summaryExecutor;

  /** DONE 이벤트 발행 — 임베딩 nudge 트리거. markSummarized txTemplate 안에서 publishEvent 해야 AFTER_COMMIT 발화. */
  private final ApplicationEventPublisher events;

  public FileExtractionPipeline(
      WorkerJobRepository jobs,
      WorkerClient worker,
      WorkerProperties props,
      AiAgentDriveClient driveClient,
      AssistantResolver assistantResolver,
      DSLContext dsl,
      PlatformTransactionManager txManager,
      @Qualifier("issueAiSummaryExecutor") Executor summaryExecutor,
      ApplicationEventPublisher events) {
    this.jobs = jobs;
    this.worker = worker;
    this.props = props;
    this.driveClient = driveClient;
    this.assistantResolver = assistantResolver;
    this.dsl = dsl;
    this.txTemplate = new TransactionTemplate(txManager);
    this.summaryExecutor = summaryExecutor;
    this.events = events;
  }

  /**
   * 지정 파일의 file_extraction 을 PENDING→EXTRACTING 으로 CAS 전이하고 워커에 추출 작업을 디스패치한다.
   *
   * <p>CAS 실패(다른 디스패처가 이미 EXTRACTING 으로 변경)면 early-return. 트랜잭션 내에서 CAS + worker_job 생성까지 수행하고, 커밋
   * 후 WorkerClient.dispatchExtract 를 호출한다.
   *
   * <p>WorkerClient HTTP 호출은 TransactionSynchronization.afterCommit 으로 커밋 완료 후에 실행한다. DB 커넥션이 HTTP
   * 대기 시간 동안 점유되지 않으며, 롤백 시 afterCommit 이 발화하지 않아 커밋되지 않은 jobId 로 워커를 오염시키지 않는다. HTTP 실패 시 롤백이 없지만
   * 재시도 스케줄러가 EXTRACTING 상태로 남은 행을 재처리한다.
   */
  @Transactional
  public void dispatchPending(long fileId) {
    // 워커 비활성 → claim 도 디스패치도 하지 않음. 행은 PENDING 유지(워커 켜지면 스케줄러가 재개).
    // 비활성 배포에서 매 틱 EXTRACTING claim→HTTP 실패→로그 스팸·고착을 원천 차단한다.
    if (!props.enabled()) {
      log.debug("워커 비활성 — 추출 디스패치 skip(PENDING 유지): fileId={}", fileId);
      return;
    }

    // PENDING→EXTRACTING CAS: 실패 시 다른 디스패처가 이미 가져간 것 → 무시
    if (!jobs.claimForExtraction(fileId)) {
      log.debug("파일 추출 CAS 실패 — 다른 디스패처가 소유: fileId={}", fileId);
      return;
    }

    // 파일 메타 조회(storageKey, mime, tenantId)
    var meta =
        dsl.select(FILE.STORAGE_PATH, FILE.MIME_TYPE, FILE_EXTRACTION.TENANT_ID)
            .from(FILE)
            .join(FILE_EXTRACTION)
            .on(FILE_EXTRACTION.FILE_ID.eq(FILE.ID))
            .where(FILE.ID.eq(fileId))
            .fetchOne();

    if (meta == null) {
      log.error("파일 메타 조회 실패: fileId={}", fileId);
      return;
    }

    String storageKey = meta.get(FILE.STORAGE_PATH);
    String mime = meta.get(FILE.MIME_TYPE);
    long tenantId = meta.get(FILE_EXTRACTION.TENANT_ID);

    // worker_job 생성 (params: {fileId, storageKey, mime} — Jackson 직렬화)
    long jobId = jobs.createExtractJob(tenantId, fileId, storageKey, mime);

    // TransactionSynchronization.afterCommit 으로 커밋 완료 후 HTTP push 등록.
    final long capturedJobId = jobId;
    final long capturedFileId = fileId;
    final String capturedStorageKey = storageKey;
    final String capturedMime = mime;
    final long capturedTenantId = tenantId;
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCommit() {
            try {
              // tenantId 를 페이로드에 포함해 워커가 콜백 시 에코하도록 한다(콜백 컨트롤러가 TenantContext 복원).
              worker.dispatchExtract(
                  capturedJobId, capturedStorageKey, capturedMime, capturedTenantId);
            } catch (RuntimeException ex) {
              // 워커 도달 불가 — 추출 claim 을 해제(EXTRACTING→PENDING)해 다음 스케줄러 틱에 조용히 재개한다.
              // 연결 실패는 FAILED 아님(FAILED 는 워커 실 처리 후 오류용). lease 만료(10분) 대기를 회피한다.
              //
              // ⚠️ TenantContext 를 set/clear 하지 않는다. afterCommit 은 커밋 스레드에서 동기 실행되며 그 스레드의
              // ambient TenantContext 는 이미 set 되어 있다(직전 claimForExtraction RLS UPDATE 가 성공했으므로).
              // 여기서 clear 하면 호출자(FileExtractionScheduler.runOnce 의 다음 줄 summarizePending)가 컨텍스트를
              // 잃어 RLS fail-closed 가 된다. txTemplate(TenantAwareTransactionManager) 가 ambient 로 GUC
              // 를 주입한다.
              // (대조: 같은 파일의 summarizePending 은 pooled summaryExecutor 스레드로 hop 하므로 set/clear 가 정당.)
              log.debug("워커 추출 디스패치 실패 — claim 해제 후 재개 예약: jobId={}", capturedJobId, ex);
              txTemplate.executeWithoutResult(s -> jobs.releaseExtractionClaim(capturedFileId));
            }
          }
        });
  }

  /**
   * 워커 콜백 수신: worker_job DONE 마킹 + file_extraction EXTRACTING→TEXT_READY/SKIPPED 전이.
   *
   * <p>스테일 콜백 가드: file_extraction 이 여전히 EXTRACTING 인 경우에만 전이(CAS). 이미 TEXT_READY/DONE 이면 무시.
   * worker_job 은 CAS 여부와 무관하게 DONE 으로 마킹한다(재진입 안전).
   *
   * <p>TEXT_READY 전이 성공 시 afterCommit 에서 summarizePending 을 비동기로 nudge 한다. nudge 는 afterCommit 에
   * 등록해 TEXT_READY 커밋이 완료된 이후에만 실행되도록 한다 — 트랜잭션 내 즉시 실행 시 CAS 가 TEXT_READY 를 아직 못 보는 레이스가 발생한다(#476
   * 교훈).
   *
   * @param jobId worker_job.id (워커가 콜백 시 전달)
   * @param result 워커 추출 결과
   */
  @Transactional
  public void applyExtractResult(long jobId, ExtractResult result) {
    // worker_job→fileId 역조회 (params JSONB 파싱)
    Long fileId = jobs.findFileIdByJobId(jobId);
    if (fileId == null) {
      log.warn("worker_job 역조회 실패 — 알 수 없는 jobId: {}", jobId);
      return;
    }

    // worker_job DONE 마킹
    jobs.markJobDone(jobId);

    if ("DONE".equals(result.status()) && result.text() != null && !result.text().isBlank()) {
      // EXTRACTING→TEXT_READY CAS (스테일 콜백은 CAS 실패 → 무시)
      boolean advanced =
          jobs.advanceToTextReady(
              fileId,
              result.text(),
              result.charCount() != null ? result.charCount() : result.text().length(),
              Boolean.TRUE.equals(result.truncated()),
              result.lang());
      if (!advanced) {
        log.debug("TEXT_READY 전이 CAS 실패 — 스테일 콜백 무시: jobId={} fileId={}", jobId, fileId);
        return;
      }
      // TEXT_READY 커밋 후 요약 nudge — afterCommit 등록으로 커밋 완료 이후에만 CAS 가 성공함을 보장
      final long capturedFileId = fileId;
      final Long capturedTenantId = TenantContext.get();
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void afterCommit() {
              summaryExecutor.execute(
                  () -> {
                    // executor 의 TenantContextTaskDecorator 가 TenantContext 를 전파하지만
                    // afterCommit 시점에 ThreadLocal 이 이미 clear 될 수 있으므로 명시 주입.
                    if (capturedTenantId != null) {
                      TenantContext.set(capturedTenantId);
                    }
                    try {
                      summarizePending(capturedFileId);
                    } catch (RuntimeException e) {
                      log.warn("요약 nudge 실패 — 스케줄러가 재처리: fileId={}", capturedFileId, e);
                    } finally {
                      TenantContext.clear();
                    }
                  });
            }
          });
    } else {
      // DONE 이지만 텍스트 없거나 SKIPPED/FAILED → SKIPPED
      String error = result.error() != null ? result.error() : "empty-text:" + result.status();
      boolean advanced = jobs.advanceToSkipped(fileId, error);
      if (!advanced) {
        log.debug("SKIPPED 전이 CAS 실패 — 스테일 콜백 무시: jobId={} fileId={}", jobId, fileId);
      }
    }
  }

  /**
   * 파일의 요약 단계 처리: TEXT_READY→SUMMARIZING CAS → ai-agent 요약(트랜잭션 외부) → DONE.
   *
   * <p>LLM 호출(최대 180s)은 DB 커넥션을 점유하지 않도록 트랜잭션 밖에서 수행한다(#232). 세 단계로 분리:
   *
   * <ol>
   *   <li>CAS 클레임 + 컨텍스트 조회 — 짧은 트랜잭션(txTemplate)
   *   <li>ai-agent 요약 호출 — 트랜잭션 밖
   *   <li>DONE 저장 또는 TEXT_READY 복귀 — 짧은 트랜잭션(txTemplate)
   * </ol>
   *
   * <p>CAS 실패(이미 SUMMARIZING/DONE/SKIPPED)면 early-return — 이중 요약 방지(인라인 nudge 와 백필 스케줄러 경합 처리).
   *
   * @param fileId 대상 파일 id
   */
  public void summarizePending(long fileId) {
    // ① 클레임: TEXT_READY→SUMMARIZING CAS + 요약 컨텍스트 조회 (짧은 트랜잭션)
    // CAS 실패 시 다른 디스패처가 소유 → early-return(이중 요약 방지)
    // spec 은 CAS 이전에 조회해 실패 시 SUMMARIZING 행을 남기지 않는다.
    final SummaryContext[] ctxHolder = new SummaryContext[1];
    final AssistantSpec[] specHolder = new AssistantSpec[1];

    boolean claimed =
        Boolean.TRUE.equals(
            txTemplate.execute(
                status -> {
                  // AssistantSpec 을 CAS 이전에 조회 — 미설정이면 claim 하지 않고 종료
                  var specOpt = assistantResolver.resolveWorkspaceOrEmpty();
                  if (specOpt.isEmpty()) {
                    log.debug("요약 비서 미설정 — 테넌트에 공용 비서 없음: fileId={}", fileId);
                    return false;
                  }
                  specHolder[0] = specOpt.get();

                  // CAS: TEXT_READY→SUMMARIZING (attempts 증가 포함)
                  if (!jobs.claimForSummary(fileId)) {
                    log.debug("요약 CAS 실패 — 다른 디스패처가 소유: fileId={}", fileId);
                    return false;
                  }

                  // 요약 컨텍스트 조회 (CAS 성공 후 동일 트랜잭션에서 읽어 일관성 보장)
                  ctxHolder[0] = jobs.findSummaryContext(fileId);
                  return true;
                }));

    if (!claimed) {
      return;
    }

    SummaryContext ctx = ctxHolder[0];
    AssistantSpec spec = specHolder[0];

    if (ctx == null) {
      log.error("요약 컨텍스트 조회 실패 — TEXT_READY 복귀: fileId={}", fileId);
      txTemplate.executeWithoutResult(
          status -> jobs.revertToTextReady(fileId, "summary-context-not-found"));
      return;
    }

    // ② ai-agent 요약 호출 (트랜잭션 밖 — DB 커넥션 비점유)
    AiAgentDriveClient.Res res;
    try {
      res =
          driveClient.summarize(
              new AiAgentDriveClient.Req(
                  ctx.text() != null ? ctx.text() : "",
                  ctx.fileName() != null ? ctx.fileName() : "",
                  ctx.mime() != null ? ctx.mime() : "",
                  spec.agentUserId(),
                  spec.model(),
                  MAX_TURNS,
                  spec.timeoutMs()));
    } catch (RuntimeException ex) {
      // ③-실패: attempts 값에 따라 FAILED(단말) 또는 TEXT_READY(재시도) 전이.
      // claimForSummary 에서 이미 attempts++ 되었으므로 DB 값이 최신 post-increment 값이다.
      // 단일 txTemplate 블록에서 조회 + 전이를 원자적으로 수행해 FAILED/TEXT_READY 판단이 레이스 없이 결정된다.
      txTemplate.executeWithoutResult(
          s -> {
            Integer attempts = jobs.findAttempts(fileId);
            if (attempts != null && attempts >= MAX_SUMMARY_ATTEMPTS) {
              // 최대 시도 횟수 도달 → FAILED(단말). 이후 findResumable + claimForSummary 에서 제외.
              log.warn(
                  "ai-agent 드라이브 요약 최대 시도({}) 도달 — FAILED 처리: fileId={}", attempts, fileId, ex);
              jobs.markFailed(fileId, ex.getMessage());
            } else {
              // 상한 미도달 → TEXT_READY 복귀(재시도 가능)
              log.warn(
                  "ai-agent 드라이브 요약 실패(attempts={}) — TEXT_READY 복귀: fileId={}",
                  attempts,
                  fileId,
                  ex);
              jobs.revertToTextReady(fileId, ex.getMessage());
            }
          });
      throw ex;
    }

    // ③-성공: DONE 저장 + 임베딩 nudge 이벤트 발행(같은 트랜잭션 안 — AFTER_COMMIT 리스너 정상 발화 보장)
    final String summary = res.summary();
    final String model = spec.model();
    final long tenantId = ctx.tenantId();
    txTemplate.executeWithoutResult(
        status -> {
          jobs.markSummarized(fileId, summary, model);
          // DONE 행이 커밋된 후 FileEmbeddingListener.onDone 이 dispatchEmbed 를 nudge.
          // 이벤트를 txTemplate 밖에서 발행하면 트랜잭션이 없어 AFTER_COMMIT 리스너가 silently dropped 됨.
          events.publishEvent(new FileExtractionDoneEvent(fileId, tenantId));
        });
    log.debug("파일 요약 완료: fileId={}", fileId);
  }
}
