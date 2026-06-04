package com.workplace.drive.service;

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

  /** 1시간 주기(FileCleanupService 와 동일 간격). */
  @Scheduled(fixedRate = 3_600_000)
  public void run() {
    OffsetDateTime cutoff = OffsetDateTime.now(ZoneOffset.UTC).minusDays(trash.retentionDays());
    trash.purgeExpired(cutoff);
    log.debug("드라이브 휴지통 자동정리 완료(cutoff={})", cutoff);
  }
}
