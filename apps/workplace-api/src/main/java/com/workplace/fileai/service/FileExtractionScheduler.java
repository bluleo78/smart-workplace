package com.workplace.fileai.service;

import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.inbound.ExtractionBackfillSource;
import com.workplace.fileai.repository.WorkerJobRepository;
import com.workplace.global.outbound.AgentOutageGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 파일 추출·요약 백필 스케줄러. 3분 주기로 미완(PENDING/lease 만료 EXTRACTING·SUMMARIZING/TEXT_READY) 파일을 재처리한다. ① 수집
 * 전에 기존 첨부 백필 시드(WP-244)도 한다.
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

  /** 회차당 테넌트·소스별 백필 시드 상한 — 백로그는 3분 주기로 소진된다(WP-244). */
  static final int BACKFILL_BATCH = 100;

  private final List<ExtractionBackfillSource> backfillSources;
  private final FileExtractionRowWriter rowWriter;

  /** 3분 주기 백필. */
  @Scheduled(fixedRate = 180_000)
  @SchedulerLock(name = "FileExtractionScheduler.runOnce")
  public void runOnce() {
    // ① 테넌트별 재개 대상 수집 — Runner 가 테넌트별 짧은 트랜잭션 + GUC 주입(RLS 통과).
    List<TenantFile> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          // 기존 첨부 백필(WP-244): 추출 행이 없는 첨부에 TEXT_ONLY 행을 만든다 — 아래 findResumable 이 같은 회차에 디스패치한다.
          seedMissingAttachments(tenantId);
          for (long fileId : jobRepo.findResumable()) {
            targets.add(new TenantFile(tenantId, fileId));
          }
        });

    // ② 파일별 처리 — Runner 트랜잭션 밖. TenantContext 만 주입하면 pipeline 내부 짧은 트랜잭션이 GUC 주입.
    // ai-agent 가 연속으로 불가하면(재기동 중 등) 남은 파일의 요약만 건너뛴다(WP-177). 추출은 워커 몫이라 계속 디스패치한다.
    AgentOutageGuard guard = new AgentOutageGuard();
    int summarySkipped = 0;
    for (TenantFile t : targets) {
      TenantContext.set(t.tenantId());
      try {
        // PENDING 또는 lease 만료 EXTRACTING → 추출 재디스패치(CAS 로 이중 잡 방지)
        pipeline.dispatchPending(t.fileId());
        if (guard.tripped()) {
          summarySkipped++;
          continue;
        }
        // TEXT_READY 또는 lease 만료 SUMMARIZING → 요약 재시도(CAS 로 이중 요약 방지)
        switch (pipeline.summarizePending(t.fileId())) {
          case SUMMARIZED, ATTEMPT_FAILED -> guard.recordResponse(); // agent 가 응답했다
          case AGENT_UNAVAILABLE -> guard.recordUnavailable();
          case SKIPPED -> {} // agent 를 부르지 않았다 — 판단 근거 아님
        }
      } catch (RuntimeException e) {
        // agent 를 부르기 전후의 DB 오류 등 — 다음 파일로. agent 응답 여부를 알 수 없어 연속 불가 횟수는 건드리지 않는다.
        log.warn("백필 처리 실패 tenant={} fileId={} — 다음 주기에 재시도", t.tenantId(), t.fileId(), e);
      } finally {
        TenantContext.clear();
      }
    }
    if (guard.tripped()) {
      log.warn("파일 요약 회차 중단 — ai-agent 불가, 남은 파일 {}개의 요약은 다음 주기", summarySkipped);
    }
  }

  /**
   * 소스마다 추출 행이 없는 첨부를 최대 {@value #BACKFILL_BATCH}건 TEXT_ONLY 로 시드한다. 테넌트 GUC 가 주입된 트랜잭션 안에서 호출해야
   * 한다(소스 조회·행 삽입 모두 RLS 범위). 빠진 행만 만들므로 멱등이다.
   */
  void seedMissingAttachments(long tenantId) {
    for (ExtractionBackfillSource source : backfillSources) {
      for (ExtractionBackfillSource.Target t : source.findMissing(BACKFILL_BATCH)) {
        rowWriter.write(t.fileId(), tenantId, t.mime(), ExtractionProfile.TEXT_ONLY);
      }
    }
  }
}
