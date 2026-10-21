package com.workplace.fileai.service;

import com.workplace.fileai.ExtractableTypes;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 파일 추출 요청을 받아 file_extraction 행을 만들고 커밋 후 워커로 디스패치한다(WP-242).
 *
 * <p>두 단계로 나눈다. ① {@link #onRequested} 는 발행 트랜잭션 안에서 동기로 PENDING/SKIPPED 행을 쓴다 — 업로드·바인딩과 함께 커밋되거나
 * 함께 롤백되므로 "커밋됐는데 추출 행이 없는" 유실이 생기지 않는다(예전 AFTER_COMMIT 생성은 그 사이 실패 시 백스톱도 찾지 못했다). ② {@link
 * #dispatchAfterCommit} 은 커밋 후 워커 HTTP 디스패치를 nudge 한다. 실패해도 행이 PENDING 으로 남아
 * FileExtractionScheduler 백스톱이 재디스패치한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FileExtractionListener {

  private final FileExtractionRowWriter rowWriter;
  private final FileExtractionPipeline pipeline;

  /**
   * 발행 트랜잭션 안에서 추출 행 생성. mime 이 추출 가능하면 PENDING, 아니면(이미지·미지원) SKIPPED + 원시 사유.
   *
   * @throws IllegalStateException 트랜잭션 밖에서 발행된 경우 — 원자성 계약 위반이라 조용히 넘기지 않는다
   */
  @EventListener
  public void onRequested(FileExtractionRequestedEvent e) {
    if (!TransactionSynchronizationManager.isActualTransactionActive()) {
      throw new IllegalStateException(
          "FileExtractionRequestedEvent 는 트랜잭션 안에서 발행해야 한다: fileId=" + e.fileId());
    }
    rowWriter.write(e.fileId(), e.tenantId(), e.mime(), e.profile());
  }

  /**
   * 커밋 후 추출 nudge. 커밋한 스레드에는 원 커넥션이 아직 묶여 있으므로 별도 실행기({@link FileAiNudgeExecutorConfig})로 넘겨 그
   * 스레드에서 dispatchPending 의 트랜잭션으로 선점·디스패치한다(WP-751 — 커밋 스레드에서 REQUIRES_NEW 로 두 번째 커넥션을 빌리던 교착 제거).
   * TenantContext 는 실행기 데코레이터가 옮겨 GUC 가 주입된다. dispatchPending 의 afterCommit(HTTP push)은 그 새 트랜잭션 커밋
   * 후 발화한다.
   */
  @Async(FileAiNudgeExecutorConfig.EXECUTOR)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void dispatchAfterCommit(FileExtractionRequestedEvent e) {
    if (!ExtractableTypes.supports(e.mime())) return;
    try {
      pipeline.dispatchPending(e.fileId());
    } catch (RuntimeException ex) {
      log.warn("추출 nudge dispatchPending 실패 — 스케줄러가 재처리: fileId={}", e.fileId(), ex);
    }
  }
}
