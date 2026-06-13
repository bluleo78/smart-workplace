package com.workplace.drive.service;

import com.workplace.global.tenant.TenantScopedRunner;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 휴지통 자동 비우기 — 보존기간 경과 trash_root 를 주기적으로 영구삭제. */
@Slf4j
@Component
@RequiredArgsConstructor
public class DriveTrashCleanupJob {
  private final DriveTrashService trash;
  // drive_folder/drive_file 은 RLS 적용 테이블 — 활성 테넌트마다 GUC 를 주입해 순회한다.
  private final TenantScopedRunner tenantScopedRunner;

  /**
   * 1시간 주기(FileCleanupService 와 동일 간격). 활성 테넌트별로 트랜잭션을 열어 purgeExpired 를 호출한다 — purgeExpired
   * 는 @Transactional(REQUIRED) 이라 Runner 가 연 트랜잭션에 합류한다.
   */
  @Scheduled(fixedRate = 3_600_000)
  public void run() {
    OffsetDateTime cutoff = OffsetDateTime.now(ZoneOffset.UTC).minusDays(trash.retentionDays());
    tenantScopedRunner.forEachActiveTenant(tid -> trash.purgeExpired(cutoff));
    log.debug("드라이브 휴지통 자동정리 완료(cutoff={})", cutoff);
  }
}
