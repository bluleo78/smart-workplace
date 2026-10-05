package com.workplace.fileai.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.inbound.ExtractionBackfillSource;
import com.workplace.fileai.inbound.ExtractionBackfillSource.Target;
import com.workplace.fileai.outbound.WorkerProperties;
import com.workplace.fileai.repository.WorkerJobRepository;
import com.workplace.global.tenant.TenantScopedRunner;
import java.util.List;
import java.util.stream.LongStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * WP-244: 첨부 백필 시드 예산·워커 게이트 단위 테스트(Spring 컨텍스트/DB 없이 Mockito 만). 예산은 "재개 상한 − 대기 중 TEXT_ONLY
 * PENDING 수" 라 공유 Testcontainers DB 의 잔여 행에 따라 흔들리므로, 산술 자체를 목으로 결정적으로 검증한다.
 */
@ExtendWith(MockitoExtension.class)
class FileExtractionSchedulerSeedBudgetTest {

  private static final long TENANT = 1L;

  @Mock TenantScopedRunner tenantRunner;
  @Mock WorkerJobRepository jobRepo;
  @Mock FileExtractionPipeline pipeline;
  @Mock FileExtractionRowWriter rowWriter;
  @Mock ExtractionBackfillSource first;
  @Mock ExtractionBackfillSource second;

  private FileExtractionScheduler scheduler(boolean workerEnabled) {
    return new FileExtractionScheduler(
        tenantRunner,
        jobRepo,
        pipeline,
        List.of(first, second),
        rowWriter,
        new WorkerProperties(null, null, workerEnabled, null));
  }

  /** fileId from..from+n-1 의 PDF 대상 n 건. */
  private static List<Target> targets(long from, int n) {
    return LongStream.range(from, from + n)
        .mapToObj(id -> new Target(id, "application/pdf"))
        .toList();
  }

  @Test
  void 예산은_재개_상한에서_대기중_TEXT_ONLY_PENDING_수를_뺀_만큼이고_소스_순서대로_나눠_쓴다() {
    given(jobRepo.resumeBatchSize()).willReturn(50);
    given(jobRepo.countPendingTextOnly()).willReturn(45);
    given(first.findMissing(5)).willReturn(targets(1, 3));
    given(second.findMissing(2)).willReturn(targets(10, 2));

    scheduler(true).seedMissingAttachments(TENANT);

    verify(first).findMissing(5);
    verify(second).findMissing(2);
    verify(rowWriter, times(5))
        .write(anyLong(), anyLong(), anyString(), any(ExtractionProfile.class));
  }

  @Test
  void 앞_소스가_예산을_다_쓰면_다음_소스는_조회하지_않는다() {
    given(jobRepo.resumeBatchSize()).willReturn(50);
    given(jobRepo.countPendingTextOnly()).willReturn(47);
    given(first.findMissing(3)).willReturn(targets(1, 3));

    scheduler(true).seedMissingAttachments(TENANT);

    verify(second, never()).findMissing(anyInt());
  }

  @Test
  void 대기중_PENDING_이_재개_상한_이상이면_시드하지_않는다() {
    given(jobRepo.resumeBatchSize()).willReturn(50);
    given(jobRepo.countPendingTextOnly()).willReturn(60);

    scheduler(true).seedMissingAttachments(TENANT);

    verify(first, never()).findMissing(anyInt());
    verify(second, never()).findMissing(anyInt());
  }

  @Test
  void 예산은_BACKFILL_BATCH_를_넘지_않는다() {
    given(jobRepo.resumeBatchSize()).willReturn(100_000);
    given(jobRepo.countPendingTextOnly()).willReturn(0);
    given(first.findMissing(FileExtractionScheduler.BACKFILL_BATCH)).willReturn(List.of());
    given(second.findMissing(FileExtractionScheduler.BACKFILL_BATCH)).willReturn(List.of());

    scheduler(true).seedMissingAttachments(TENANT);

    verify(first).findMissing(FileExtractionScheduler.BACKFILL_BATCH);
    verify(second).findMissing(FileExtractionScheduler.BACKFILL_BATCH);
  }

  @Test
  void 워커_비활성이면_runOnce_가_시드_패스를_돌지_않는다() {
    // 비활성이면 dispatchPending 이 no-op 이라 시드한 행이 영원히 PENDING 으로 남는다 — 시드 패스 자체를 건너뛴다.
    scheduler(false).runOnce();
    // 테넌트 순회는 재개 수집 1회뿐(시드 패스 없음).
    verify(tenantRunner, times(1)).forEachActiveTenant(any());
  }

  @Test
  void 워커_활성이면_runOnce_가_시드_패스와_수집_패스를_돈다() {
    scheduler(true).runOnce();
    verify(tenantRunner, times(2)).forEachActiveTenant(any());
  }
}
