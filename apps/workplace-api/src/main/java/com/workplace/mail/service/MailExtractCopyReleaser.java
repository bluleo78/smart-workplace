package com.workplace.mail.service;

import com.workplace.fileai.event.FileExtractionSettledEvent;
import com.workplace.global.tenant.TenantContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 첨부 추출 사본의 평문 바이너리를 추출 확정 직후 지운다(WP-358).
 *
 * <p>메일 첨부는 디스크에 암호화 저장되는 것이 원칙인데, 워커가 읽을 수 있게 만든 평문 사본은 예외다. 워커가 결과를 돌려준 뒤(텍스트 저장 또는 SKIPPED) 에는
 * 바이너리가 더 필요 없으므로 지워서 평문이 디스크에 남는 시간을 워커 처리 시간으로 줄인다. file 행과 추출 텍스트는 /text 가 읽으므로 남긴다 ({@link
 * com.workplace.fileai.service.ExtractedTextService#read} 는 바이너리를 읽지 않는다).
 */
@Slf4j
@Component
public class MailExtractCopyReleaser {

  private final MailExtractCopyStore copyStore;
  private final TransactionTemplate readTx;

  public MailExtractCopyReleaser(
      MailExtractCopyStore copyStore, PlatformTransactionManager txManager) {
    this.copyStore = copyStore;
    // 원 트랜잭션은 이미 커밋됐다 — 사본 여부 조회(RLS)용 새 읽기 트랜잭션. TenantAwareTransactionManager 가 시작 시점 GUC 를 주입한다.
    this.readTx = new TransactionTemplate(txManager);
    this.readTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    this.readTx.setReadOnly(true);
  }

  /** 추출 확정(커밋 후) → 메일 사본이면 바이너리 삭제. 실패는 삼킨다 — 남은 바이너리는 사본 만료 시 FileCleanupService 가 지운다. */
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onSettled(FileExtractionSettledEvent e) {
    Long previous = TenantContext.get();
    TenantContext.set(e.tenantId());
    try {
      readTx.execute(s -> copyStore.copyStoragePath(e.fileId())).ifPresent(copyStore::deleteBinary);
    } catch (RuntimeException ex) {
      log.warn("메일 추출 사본 정리 실패(무시) fileId={}", e.fileId(), ex);
    } finally {
      if (previous != null) TenantContext.set(previous);
      else TenantContext.clear();
    }
  }
}
