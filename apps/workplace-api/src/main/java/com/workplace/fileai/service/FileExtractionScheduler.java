package com.workplace.fileai.service;

import com.workplace.fileai.repository.WorkerJobRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 파일 추출·요약 백필 스케줄러. 3분 주기로 미완(PENDING/lease 만료 EXTRACTING·SUMMARIZING/TEXT_READY) 파일을 재처리한다.
 *
 * <p>MailSummaryScheduler 의 2단계 패턴을 미러한다. ① {@link TenantScopedRunner} 로 테넌트별 짧은 트랜잭션에서 재개 대상 목록만
 * 수집(RLS 통과), ② Runner 트랜잭션 밖에서 TenantContext 만 주입해 dispatchPending/summarizePending 처리 — IMAP/LLM
 * 이 DB 커넥션을 장기 점유하지 않게 한다(#232).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FileExtractionScheduler {

  /** 수집 단계 산출 — 어느 테넌트의 어느 파일인지. */
  private record TenantFile(long tenantId, long fileId) {}

  private final TenantScopedRunner tenantRunner;
  private final WorkerJobRepository jobRepo;
  private final FileExtractionPipeline pipeline;

  /** 3분 주기 백필. */
  @Scheduled(fixedRate = 180_000)
  void runOnce() {
    // ① 테넌트별 재개 대상 수집 — Runner 가 테넌트별 짧은 트랜잭션 + GUC 주입(RLS 통과).
    List<TenantFile> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          for (long fileId : jobRepo.findResumable()) {
            targets.add(new TenantFile(tenantId, fileId));
          }
        });

    // ② 파일별 처리 — Runner 트랜잭션 밖. TenantContext 만 주입하면 pipeline 내부 짧은 트랜잭션이 GUC 주입.
    for (TenantFile t : targets) {
      TenantContext.set(t.tenantId());
      try {
        // PENDING 또는 lease 만료 EXTRACTING → 추출 재디스패치(CAS 로 이중 잡 방지)
        pipeline.dispatchPending(t.fileId());
        // TEXT_READY 또는 lease 만료 SUMMARIZING → 요약 재시도(CAS 로 이중 요약 방지)
        pipeline.summarizePending(t.fileId());
      } catch (RuntimeException e) {
        log.warn("백필 처리 실패 tenant={} fileId={} — 다음 주기에 재시도", t.tenantId(), t.fileId(), e);
      } finally {
        TenantContext.clear();
      }
    }
  }
}
