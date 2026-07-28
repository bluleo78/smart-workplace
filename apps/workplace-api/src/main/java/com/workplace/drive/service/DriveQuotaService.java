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

  /**
   * 현재 테넌트의 저장소 사용량(바이트) — 드라이브 + 노트 첨부(#759).
   *
   * <p>이름은 드라이브지만 집계 범위는 드라이브만이 아니다. 노트 첨부가 쿼터 밖이던 것이 #759 의 무제한 증가 경로였다.
   *
   * <p>아직 집계 밖: 이슈·메시징·채팅 첨부. 그쪽은 상한이 매핑 개수 기준이라 무제한 루프는 없지만 쿼터에도 안 잡힌다 — 포함시키면 기존 테넌트 사용량이 급증해 한도
   * 초과로 전환되므로 정책 결정이 선행돼야 한다(별도 이슈).
   */
  public long usedBytes() {
    return repo.sumDriveUsageBytes() + repo.sumWikiAttachmentBytes();
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
   * 락 획득 + 쿼터 검사를 한 번에 — 호출자가 순서를 조립하거나 drive repository 를 직접 만지지 않도록 묶었다(#759).
   *
   * <p>락은 테넌트 컨텍스트가 있을 때만 잡지만, 검사 자체는 항상 수행한다(fail-open 금지).
   */
  public void assertWithinQuotaLocked(long incomingBytes) {
    Long tenantId = TenantContext.get();
    if (tenantId != null) {
      // 락은 테넌트 컨텍스트가 있을 때만 — 검사 자체는 항상 수행한다(fail-open 금지).
      repo.advisoryLockTenant(tenantId);
    }
    assertWithinQuota(incomingBytes);
  }

  /**
   * 업로드 가능 여부 검사. 초과 시 {@link DriveQuotaExceededException}.
   *
   * <p>동시성: 호출자(업로드 트랜잭션)가 먼저 advisory lock 을 잡은 상태여야 정확하다 — 락까지 함께 원하는 호출자는 {@link
   * #assertWithinQuotaLocked} 를 쓴다.
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
