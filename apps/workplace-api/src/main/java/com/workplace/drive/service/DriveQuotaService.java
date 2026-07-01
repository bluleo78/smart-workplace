package com.workplace.drive.service;

import com.workplace.drive.exception.DriveQuotaExceededException;
import com.workplace.drive.repository.DriveQuotaRepository;
import com.workplace.global.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 드라이브 용량 쿼터 — 테넌트 단위 사용량/한도 조회 및 초과 검사. */
@Service
public class DriveQuotaService {

  /** 사용량/한도 스냅샷. */
  public record QuotaView(long usedBytes, long quotaBytes) {}

  private final DriveQuotaRepository repo;
  private final long defaultQuotaBytes;

  public DriveQuotaService(
      DriveQuotaRepository repo,
      @Value("${workplace.drive.default-quota-bytes:10737418240}") long defaultQuotaBytes) {
    this.repo = repo;
    this.defaultQuotaBytes = defaultQuotaBytes;
  }

  /** 현재 테넌트의 드라이브 사용량(바이트). */
  public long usedBytes() {
    return repo.sumDriveUsageBytes();
  }

  /** 현재 테넌트의 한도(바이트). 컨텍스트가 없으면 기본값. */
  public long quotaBytes() {
    Long tenantId = TenantContext.get();
    return tenantId == null ? defaultQuotaBytes : repo.findQuotaBytes(tenantId);
  }

  /**
   * 사이드바/조회용 스냅샷.
   *
   * <p>{@code @Transactional} 필수: usedBytes()→sumDriveUsageBytes() 는 RLS(FORCE) 보호 테이블
   * (drive_file_version/drive_file/file)을 SUM 한다. 트랜잭션이 없으면 {@code TenantAwareTransactionManager} 가
   * app.tenant_id GUC 를 주입하지 못해 RLS 가 fail-closed → 0행 → 사용량 0 으로 오표시된다(비-@Transactional read → RLS
   * fail-closed 패턴). 컨트롤러는 이 프록시된 view() 를 호출하고, view() 내부의 usedBytes() 는 self-invocation 이므로 반드시
   * 진입점인 view() 에 트랜잭션을 건다.
   */
  @Transactional(readOnly = true)
  public QuotaView view() {
    return new QuotaView(usedBytes(), quotaBytes());
  }

  /**
   * 업로드 가능 여부 검사. 초과 시 {@link DriveQuotaExceededException}.
   *
   * <p>동시성: 호출자(업로드 트랜잭션)가 먼저 advisory lock 을 잡은 상태여야 정확하다.
   */
  public void assertWithinQuota(long incomingBytes) {
    long used = usedBytes();
    long quota = quotaBytes();
    if (used + incomingBytes > quota) {
      throw new DriveQuotaExceededException(
          String.format("저장 용량을 초과했습니다 (사용 %d / 한도 %d 바이트).", used, quota));
    }
  }
}
