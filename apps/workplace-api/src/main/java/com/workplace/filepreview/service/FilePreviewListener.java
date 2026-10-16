package com.workplace.filepreview.service;

import com.workplace.filepreview.inbound.FilePreviewRequestedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 드라이브 업로드 커밋 뒤 문서 미리 변환을 백그라운드 실행기에 맡긴다(WP-431).
 *
 * <p>AFTER_COMMIT 인 이유: 실행기 작업이 커밋 전 file 행을 보지 못하는 일이 없게, 업로드가 롤백되면 변환하지 않게. 미리 변환은 최선 노력이라 예외는
 * 로그만 남긴다 — 업로드 응답에 영향을 주지 않는다(첫 열람이 다시 변환한다).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FilePreviewListener {

  private final FilePreviewService previewService;

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onRequested(FilePreviewRequestedEvent e) {
    try {
      previewService.requestBackground(e.tenantId(), e.fileId(), e.mime(), e.originalName());
    } catch (RuntimeException ex) {
      log.warn("미리보기 백그라운드 요청 실패: fileId={} error={}", e.fileId(), ex.toString());
    }
  }
}
