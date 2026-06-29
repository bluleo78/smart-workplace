package com.workplace.fileai.service;

import com.workplace.fileai.dto.EmbedResult;
import com.workplace.fileai.outbound.WorkerClient;
import com.workplace.fileai.outbound.WorkerProperties;
import com.workplace.fileai.repository.WorkerJobRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 추출 완료 파일을 임베딩 큐에 올리고(afterCommit 워커 디스패치), 워커 콜백을 멱등 적용한다.
 *
 * <p>dispatchEmbed: DONE 파일에 embed worker_job 생성 + afterCommit 워커 HTTP push(이중 잡 방지:
 * hasPendingEmbedJob CAS). applyEmbedResult: 워커 콜백 수신 시 embedding 벡터를 멱등 UPDATE(embedding IS NULL
 * 조건). 실패 시 worker_job FAILED.
 */
@Slf4j
@Service
public class FileEmbeddingPipeline {

  private final WorkerJobRepository jobs;
  private final WorkerClient worker;
  private final WorkerProperties props;

  public FileEmbeddingPipeline(
      WorkerJobRepository jobs, WorkerClient worker, WorkerProperties props) {
    this.jobs = jobs;
    this.worker = worker;
    this.props = props;
  }

  /**
   * DONE 파일의 추출 텍스트를 임베딩 디스패치.
   *
   * <p>살아있는 embed 잡 있으면 skip(중복 차단). 워커 HTTP 는 afterCommit — DB 커넥션 반납 후 HTTP(트랜잭션 점유 회피). 롤백 시
   * afterCommit 미발화 → 미커밋 jobId 로 워커 오염 없음.
   *
   * @param fileId 대상 파일 ID (file_extraction.status=DONE 이어야 함)
   */
  @Transactional
  public void dispatchEmbed(long fileId) {
    // 워커 비활성 또는 임베딩 게이트 off → 임베딩 미생성(키워드 검색은 추출이 계속 공급)
    if (!props.enabled() || !props.embed().enabled()) {
      return;
    }
    if (jobs.hasPendingEmbedJob(fileId)) {
      log.debug("임베딩 이미 RUNNING — skip: fileId={}", fileId);
      return;
    }
    // DONE 상태 파일의 추출 텍스트 + tenantId 조회
    var ctx = jobs.findEmbedContext(fileId);
    if (ctx.isEmpty()) {
      log.debug("임베딩 컨텍스트 없음(DONE 아님) — skip: fileId={}", fileId);
      return;
    }
    var c = ctx.get();

    // embed worker_job 생성 (RUNNING + lease)
    long jobId = jobs.createEmbedJob(c.tenantId(), fileId, c.text());

    final long capturedJobId = jobId;
    final String capturedText = c.text();
    final long capturedTenantId = c.tenantId();

    // 커밋 후 워커 호출 — DB 커넥션 반납 후 HTTP(트랜잭션 점유 회피)
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCommit() {
            worker.dispatchEmbed(capturedJobId, capturedText, capturedTenantId);
          }
        });
  }

  /**
   * 워커 임베딩 콜백 적용.
   *
   * <p>tenantId 는 Controller 가 이미 TenantContext 에 set(C1 패턴). 멱등 UPDATE(embedding IS NULL 조건). 실패 시
   * worker_job FAILED — 파일 상태는 DONE 유지(키워드 검색은 계속 가능).
   *
   * @param jobId worker_job.id (워커가 콜백 시 전달)
   * @param result 워커 임베딩 결과
   */
  @Transactional
  public void applyEmbedResult(long jobId, EmbedResult result) {
    Long fileId = jobs.findFileIdByJobId(jobId);
    if (fileId == null) {
      log.warn("embed worker_job 역조회 실패 — 알 수 없는 jobId: {}", jobId);
      return;
    }
    if (result.error() != null) {
      // 임베딩 실패 — worker_job FAILED, 파일 상태는 DONE 유지
      log.warn("임베딩 워커 실패: jobId={} fileId={} error={}", jobId, fileId, result.error());
      jobs.markEmbedJobFailed(jobId, result.error());
      return;
    }
    if (result.embedding() == null) {
      log.warn("임베딩 결과 벡터 없음: jobId={} fileId={}", jobId, fileId);
      jobs.markEmbedJobFailed(jobId, "null-embedding");
      return;
    }
    // 차원 불일치: pgvector UPDATE 전에 검증해 markEmbedJobFailed 경로를 보장한다(DB 예외 경로는 FAILED 미기록).
    if (result.dimensions() != null && result.dimensions() != props.embed().dimensions()) {
      log.warn(
          "임베딩 차원 불일치: jobId={} fileId={} got={} expected={}",
          jobId,
          fileId,
          result.dimensions(),
          props.embed().dimensions());
      jobs.markEmbedJobFailed(
          jobId,
          "dimension-mismatch: got "
              + result.dimensions()
              + " expected "
              + props.embed().dimensions());
      return;
    }
    // 멱등 UPDATE: embedding IS NULL 조건으로 중복 콜백 안전
    int updated = jobs.applyEmbedResult(fileId, toVectorLiteral(result.embedding()));
    jobs.markJobDone(jobId);
    if (updated == 0) {
      log.debug("임베딩 멱등 skip (already set): jobId={} fileId={}", jobId, fileId);
    } else {
      log.debug("임베딩 적용 완료: jobId={} fileId={}", jobId, fileId);
    }
  }

  /**
   * float[] → pgvector 텍스트 리터럴 "[v1,v2,...]".
   *
   * <p>cast(? as vector) 로 바인딩할 리터럴 형식. search_tv 는 건드리지 않는다.
   *
   * @param v 임베딩 벡터
   * @return pgvector 리터럴 문자열
   */
  static String toVectorLiteral(float[] v) {
    StringBuilder sb = new StringBuilder("[");
    for (int i = 0; i < v.length; i++) {
      if (i > 0) sb.append(',');
      sb.append(v[i]);
    }
    return sb.append(']').toString();
  }
}
