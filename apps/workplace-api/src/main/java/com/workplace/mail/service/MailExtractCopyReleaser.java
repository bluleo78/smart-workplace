package com.workplace.mail.service;

import com.workplace.fileai.event.FileExtractionSettledEvent;
import com.workplace.global.util.AfterCommit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 메일 첨부 추출 사본의 평문 바이너리를 추출 확정 직후 지운다(WP-358).
 *
 * <p>메일 첨부는 디스크에 암호화 저장되는 것이 원칙인데, 워커가 읽을 수 있게 만든 평문 사본은 예외다. 워커가 결과를 돌려준 뒤(텍스트 저장 또는 SKIPPED) 에는
 * 바이너리가 더 필요 없으므로 지워서 평문이 디스크에 남는 시간을 워커 처리 시간으로 줄인다. file 행과 추출 텍스트는 /text 가 읽으므로 남긴다 ({@link
 * com.workplace.fileai.service.ExtractedTextService#read} 는 바이너리를 읽지 않는다).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MailExtractCopyReleaser {

  private final MailExtractCopyStore copyStore;

  /**
   * 추출 확정 → 메일 사본이면 바이너리 삭제. 사본 여부는 커밋 직전(BEFORE_COMMIT) 확정 트랜잭션 안에서 읽고(같은 커넥션·GUC), 삭제만 커밋 뒤로 미룬다
   * — 커밋 뒤 REQUIRES_NEW 로 다시 읽으면 원 커넥션을 쥔 채 두 번째 커넥션을 빌려 풀이 교착될 수 있다(WP-751). 롤백되면 지우지 않는다. 실패는 삼킨다
   * — 남은 바이너리는 사본 만료 시 FileCleanupService 가 지운다.
   */
  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onSettled(FileExtractionSettledEvent e) {
    try {
      copyStore
          .copyStoragePath(e.fileId())
          .ifPresent(path -> AfterCommit.run(() -> copyStore.deleteBinary(path)));
    } catch (RuntimeException ex) {
      log.warn("메일 추출 사본 정리 실패(무시) fileId={}", e.fileId(), ex);
    }
  }
}
