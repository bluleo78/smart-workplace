package com.workplace.drive.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 만료된 나눠 올리기 세션(WP-1520)을 주기적으로 정리한다 — 행과 받아 둔 임시 파일을 함께 지운다.
 *
 * <p>화면이 중간에 닫히거나 사용자가 다시 고르지 않으면 세션은 완료·취소되지 않고 남는다. 조각을 받을 때마다 만료가 24시간 뒤로 밀리므로, 마지막 조각 뒤 하루가 지난
 * 세션만 지운다. drive_upload_session 은 FORCE RLS 테이블이라 테넌트를 순회하지 않고 SECURITY DEFINER 함수({@code
 * drive_upload_session_purge_expired}) 한 번으로 지운다 — 스테이징 업로드 링크 정리({@code
 * StagedUploadLinkCleanupScheduler})와 같은 주기·잠금 관례.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DriveUploadSessionCleanupScheduler {
  private final DriveUploadSessionService uploadSessions;

  /** 시작 30초 후 첫 실행, 이후 1시간 간격. */
  @Scheduled(initialDelay = 30_000, fixedDelay = 3_600_000)
  @SchedulerLock(name = "DriveUploadSessionCleanupScheduler.purgeExpired")
  public void purgeExpired() {
    int deleted = uploadSessions.purgeExpired();
    if (deleted > 0) {
      log.debug("만료된 drive_upload_session {}건 정리", deleted);
    }
  }
}
