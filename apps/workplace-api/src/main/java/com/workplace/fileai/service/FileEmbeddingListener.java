package com.workplace.fileai.service;

import com.workplace.fileai.event.FileExtractionDoneEvent;
import com.workplace.global.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 파일 추출 DONE 이벤트 → 임베딩 디스패치 리스너.
 *
 * <p>AFTER_COMMIT + REQUIRES_NEW 로 새 트랜잭션에서 실행(FileExtractionListener 미러). 원래 트랜잭션은 이미 종료된 상태이므로
 * GUC 가 소멸했다. REQUIRES_NEW 로 새 트랜잭션을 시작하면 TenantAwareTransactionManager.doBegin 이 TenantContext 를
 * 읽어 GUC 를 재주입한다. 따라서 dispatchEmbed 내 @Transactional 이 RLS-safe 하게 진입한다.
 *
 * <p>nudge 실패는 삼킨다 — 임베딩 스케줄러 백스톱(Task 5)이 복구하므로 요약 흐름에 영향 없다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FileEmbeddingListener {

  private final FileEmbeddingPipeline pipeline;

  /**
   * DONE 이벤트 수신 → 임베딩 nudge.
   *
   * <p>TenantContext.set(tenantId) 로 GUC 를 주입한 뒤 dispatchEmbed 호출. 반드시 finally 에서 clear.
   *
   * @param e 파일 추출 완료 이벤트
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onDone(FileExtractionDoneEvent e) {
    // 리스너 스레드는 GUC 미주입 → RLS fail-closed 회피를 위해 tenant 컨텍스트 명시 set
    TenantContext.set(e.tenantId());
    try {
      pipeline.dispatchEmbed(e.fileId());
    } catch (Exception ex) {
      // nudge 실패는 삼킨다 — 스케줄러 백스톱이 복구
      log.warn("임베딩 nudge 실패 — 스케줄러가 재처리: fileId={}", e.fileId(), ex);
    } finally {
      TenantContext.clear();
    }
  }
}
