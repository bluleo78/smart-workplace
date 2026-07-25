package com.workplace.fileai.service;

import com.workplace.drive.outbound.DriveFileUploadedEvent;
import com.workplace.fileai.ExtractableTypes;
import com.workplace.fileai.repository.FileExtractionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Drive 파일 업로드 커밋 후 file_extraction 행을 생성하고 추출을 즉시 nudge 한다.
 *
 * <p>AFTER_COMMIT 에서 실행되므로 원래 트랜잭션은 이미 종료된 상태. GUC 없는 autocommit 연결에서 RLS 가 차단(fail-closed)되는 것을 막기
 * 위해 REQUIRES_NEW 로 새 트랜잭션을 시작한다. TenantAwareTransactionManager.doBegin 이 TenantContext 를 읽어 GUC 를
 * 재주입한다(MessageSseDispatcher 패턴).
 *
 * <p>PENDING 행 생성 후 dispatchPending 을 호출해 즉시 추출을 시도한다. dispatchPending 내부의 afterCommit 동기화는
 * REQUIRES_NEW 트랜잭션의 커밋 시 발화하므로 워커 HTTP push 는 정상적으로 등록된다. 스케줄러(FileExtractionScheduler)는 백스톱 역할로
 * 누락된 파일을 주기적으로 재처리한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FileExtractionListener {

  private final FileExtractionRepository repo;
  private final FileExtractionPipeline pipeline;

  /**
   * 업로드 커밋 후 호출. mime 이 추출 가능하면(#735 {@link ExtractableTypes}) PENDING 행 생성 후 dispatchPending
   * nudge, 그 외(이미지·미지원 형식)는 SKIPPED 행 생성.
   *
   * <p>기존에는 카테고리(PDF/TEXT/DATA/DOCUMENT) 축으로 게이트했으나, MIME_TO_CATEGORY 매핑에 없는 신규 형식(예: text/html)이
   * OTHER 로 떨어져 SKIPPED 로 굳는 문제가 있었다. mime 자체를 판정 축으로 삼아 워커 extract.py::_dispatch 와 1:1 미러한다.
   *
   * <p>AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입. dispatchPending 의
   * afterCommit(워커 HTTP push)은 이 REQUIRES_NEW 트랜잭션의 커밋 후 발화한다.
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onUploaded(DriveFileUploadedEvent e) {
    if (!ExtractableTypes.supports(e.mime())) {
      // 이미지·미지원 mime → SKIPPED. 사유를 구체적으로 남겨 UI 가 사용자 문구로 매핑한다(#735).
      repo.markSkipped(e.fileId(), e.tenantId(), ExtractableTypes.skipReason(e.mime()));
      return;
    }
    // 추출 가능 카테고리 → PENDING 행 생성 후 즉시 추출 nudge
    repo.upsertPending(e.fileId(), e.tenantId());
    // dispatchPending 은 PENDING→EXTRACTING CAS + worker_job 생성 + afterCommit 워커 push.
    // 스케줄러가 백스톱으로 누락된 PENDING 을 주기적으로 재처리한다.
    try {
      pipeline.dispatchPending(e.fileId());
    } catch (RuntimeException ex) {
      log.warn("업로드 nudge dispatchPending 실패 — 스케줄러가 재처리: fileId={}", e.fileId(), ex);
    }
  }
}
