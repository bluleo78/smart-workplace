package com.workplace.drive.service;

import com.workplace.drive.exception.DriveQuotaExceededException;
import com.workplace.drive.repository.DriveQuotaRepository;
import com.workplace.file.api.StorageQuotaGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.FileSizeFormatter;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 드라이브 용량 쿼터 — 테넌트 단위 사용량/한도 조회 및 초과 검사.
 *
 * <p>file 코어의 {@link StorageQuotaGuard} 도 구현한다 — 스테이징 업로드가 drive 를 import 하지 않고 같은 잠금·한도로
 * 검사하도록(WP-1391).
 */
@Service
public class DriveQuotaService implements StorageQuotaGuard {

  /**
   * 사용량/한도 스냅샷 — 종류별 내역과 한도 밖 메일 첨부 캐시도 함께(WP-1391).
   *
   * @param usedBytes 한도 계산에 쓰는 사용량 = breakdown 합
   * @param breakdown 사용량을 종류 하나씩으로 나눈 내역
   * @param mailCacheBytes 메일 첨부 캐시(로컬 보낸 메일 사본 제외) — 보여 주기만 하고 한도에는 넣지 않는다
   */
  public record QuotaView(
      long usedBytes, long quotaBytes, Breakdown breakdown, long mailCacheBytes) {}

  /**
   * 사용량 종류별 내역(바이트). 한 file 은 한 종류에만 들어가므로 다 더하면 {@link QuotaView#usedBytes()} 와 같다.
   *
   * @param drive 드라이브 파일(옛 버전 포함, 휴지통 제외)
   * @param trash 드라이브 휴지통
   * @param wiki 노트 첨부
   * @param issue 이슈 첨부·본문 이미지
   * @param issueChat 이슈챗 첨부
   * @param otherAttachments 채팅·홈·메일 초안 첨부 + 로컬 보낸 메일 사본
   * @param unlinked 어디에도 묶이지 않은 임시·올리는 중 파일
   */
  public record Breakdown(
      long drive,
      long trash,
      long wiki,
      long issue,
      long issueChat,
      long otherAttachments,
      long unlinked) {

    /** 내역 합 — 사용량 합계와 같아야 한다. */
    public long total() {
      return drive + trash + wiki + issue + issueChat + otherAttachments + unlinked;
    }
  }

  private final DriveQuotaRepository repo;
  private final long defaultQuotaBytes;

  public DriveQuotaService(
      DriveQuotaRepository repo,
      @Value("${workplace.drive.default-quota-bytes:10737418240}") long defaultQuotaBytes) {
    this.repo = repo;
    this.defaultQuotaBytes = defaultQuotaBytes;
  }

  /**
   * 현재 테넌트의 저장소 사용량(바이트) — 한도 계산 기준(WP-1391).
   *
   * <p>테넌트 file 전체에서 내부 처리용 카테고리(메일 추출 사본 등)만 빼고, 로컬 보낸 메일의 유일 사본 blob 을 더한다. 드라이브·휴지통·노트·이슈·이슈챗·
   * 채팅·홈·메일 초안 첨부와 올리는 중인 임시 파일이 모두 들어간다. 다시 받을 수 있는 메일 첨부 캐시는 TTL 로 퇴거되므로 넣지 않는다.
   *
   * <p>예전(#759)에는 드라이브(휴지통 제외) + 노트 첨부만 세어, 이슈·채팅 첨부는 한도 없이 쌓였고 휴지통 복원 때 따로 다시 세야 했다.
   */
  public long usedBytes() {
    return repo.sumUsedBytes();
  }

  /** 현재 테넌트의 한도(바이트). 컨텍스트가 없으면 기본값. */
  public long quotaBytes() {
    Long tenantId = TenantContext.get();
    return tenantId == null ? defaultQuotaBytes : repo.findQuotaBytes(tenantId);
  }

  /**
   * 사이드바/조회용 스냅샷.
   *
   * <p>{@code @Transactional} 필수: 사용량·내역·메일 캐시 집계는 RLS(FORCE) 보호 테이블(file·매핑 테이블·
   * mail_attachment_blob)을 SUM 한다. 트랜잭션이 없으면 {@code TenantAwareTransactionManager} 가 app.tenant_id
   * GUC 를 주입하지 못해 RLS 가 fail-closed → 0행 → 사용량 0 으로 오표시된다(비-@Transactional read → RLS fail-closed
   * 패턴). 컨트롤러는 이 프록시된 view() 를 호출하므로 진입점인 view() 에 트랜잭션을 건다.
   *
   * <p>usedBytes 는 내역 합으로 채운다 — 내역은 {@link #usedBytes()} 와 같은 대상을 나눈 것이라 값이 같고(리포지토리 테스트가 고정), 따로
   * 집계하면 두 쿼리 사이에 들어온 업로드 때문에 화면의 합계와 내역 합이 어긋날 수 있다.
   */
  @Transactional(readOnly = true)
  public QuotaView view() {
    // 내역과 메일 캐시를 함께 받는다 — 메일 blob 은 로컬 보낸 메일 사본/캐시를 한 쿼리로 나눠 구한다.
    DriveQuotaRepository.Usage usage = repo.usage();
    Map<DriveQuotaRepository.Kind, Long> b = usage.breakdown();
    Breakdown breakdown =
        new Breakdown(
            b.get(DriveQuotaRepository.Kind.DRIVE),
            b.get(DriveQuotaRepository.Kind.TRASH),
            b.get(DriveQuotaRepository.Kind.WIKI),
            b.get(DriveQuotaRepository.Kind.ISSUE),
            b.get(DriveQuotaRepository.Kind.ISSUE_CHAT),
            b.get(DriveQuotaRepository.Kind.OTHER_ATTACHMENTS),
            b.get(DriveQuotaRepository.Kind.UNLINKED));
    return new QuotaView(breakdown.total(), quotaBytes(), breakdown, usage.mailCacheBytes());
  }

  /**
   * 락 획득 + 쿼터 검사를 한 번에 — 호출자가 순서를 조립하거나 drive repository 를 직접 만지지 않도록 묶었다(#759).
   *
   * <p>락은 테넌트 컨텍스트가 있을 때만 잡지만, 검사 자체는 항상 수행한다(fail-open 금지).
   */
  @Override
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
      // 원시 바이트 정수를 그대로 노출하지 않고 사람이 읽기 쉬운 단위로 변환(#821)
      throw new DriveQuotaExceededException(
          String.format(
              "저장 용량을 초과했습니다 (사용 %s / 한도 %s).",
              FileSizeFormatter.format(used), FileSizeFormatter.format(quota)));
    }
  }
}
