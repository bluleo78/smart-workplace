package com.workplace.fileai.service;

import com.workplace.fileai.outbound.WorkerProperties;
import com.workplace.fileai.repository.WorkerJobRepository;
import com.workplace.global.tenant.TenantScopedRunner;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 임베딩 백필 백스톱 스케줄러. 10분 주기로 추출 완료(DONE)됐으나 임베딩이 아직 없는 파일을 재디스패치한다.
 *
 * <p>FileExtractionScheduler 의 2단계 패턴을 미러한다. ① {@link TenantScopedRunner} 로 테넌트별 짧은 트랜잭션에서 백필 대상
 * 목록만 수집(RLS 통과), ② Runner 트랜잭션 밖에서 TenantContext 만 주입해 dispatchEmbed 처리 — DB 커넥션을 장기 점유하지 않게
 * 한다(#232 패턴).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FileEmbeddingScheduler {

  /** 수집 단계 산출 — 어느 테넌트의 어느 파일인지. */
  private record TenantFile(long tenantId, long fileId) {}

  /** 틱당 테넌트별 최대 디스패치 수(부하 상한). */
  private static final int BATCH = 50;

  private final TenantScopedRunner tenantRunner;
  private final WorkerJobRepository jobRepo;
  private final FileEmbeddingPipeline pipeline;
  private final WorkerProperties props;

  /** 10분 백스톱 백필 — 누락 또는 워커 크래시(lease 만료) 파일 재디스패치. */
  @Scheduled(fixedDelay = 600_000)
  public void backfill() {
    // 워커 비활성 또는 임베딩 게이트 off → 테넌트 순회 자체를 skip
    if (!props.enabled() || !props.embed().enabled()) {
      return;
    }
    // ① 테넌트별 백필 대상 수집 — Runner 가 테넌트별 짧은 트랜잭션 + GUC 주입(RLS 통과).
    List<TenantFile> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          for (long fileId : jobRepo.findEmbeddable(BATCH)) {
            targets.add(new TenantFile(tenantId, fileId));
          }
        });

    // ② 파일별 처리 — Runner 트랜잭션 밖. TenantContext 만 주입하면 pipeline 내부 짧은 트랜잭션이 GUC 주입.
    for (TenantFile t : targets) {
      com.workplace.global.tenant.TenantContext.set(t.tenantId());
      try {
        // DONE + embedding NULL → 임베딩 디스패치(CAS 로 이중 잡 방지)
        pipeline.dispatchEmbed(t.fileId());
      } catch (RuntimeException e) {
        log.warn("임베딩 백필 실패 tenant={} fileId={} — 다음 주기에 재시도", t.tenantId(), t.fileId(), e);
      } finally {
        com.workplace.global.tenant.TenantContext.clear();
      }
    }
  }
}
