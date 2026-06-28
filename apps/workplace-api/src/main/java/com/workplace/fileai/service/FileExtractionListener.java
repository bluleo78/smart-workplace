package com.workplace.fileai.service;

import com.workplace.drive.outbound.DriveFileUploadedEvent;
import com.workplace.fileai.repository.FileExtractionRepository;
import java.util.Set;
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

  /** 텍스트 추출이 가능한 카테고리 집합. IMAGE/미지원은 SKIPPED 처리. */
  private static final Set<String> EXTRACTABLE = Set.of("PDF", "TEXT", "DATA", "DOCUMENT");

  private final FileExtractionRepository repo;
  private final FileExtractionPipeline pipeline;

  /**
   * 업로드 커밋 후 호출. extractable 카테고리면 PENDING 행 생성 후 dispatchPending nudge, 그 외(IMAGE 등)는 SKIPPED 행
   * 생성.
   *
   * <p>AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입. dispatchPending 의
   * afterCommit(워커 HTTP push)은 이 REQUIRES_NEW 트랜잭션의 커밋 후 발화한다.
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onUploaded(DriveFileUploadedEvent e) {
    if (!EXTRACTABLE.contains(e.category())) {
      // IMAGE 등 추출 불가 카테고리 → SKIPPED
      repo.markSkipped(e.fileId(), e.tenantId(), "non-extractable:" + e.category());
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
