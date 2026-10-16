package com.workplace.file.service;

import com.workplace.file.repository.StagedUploadLinkRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 만료된 스테이징 업로드 링크(WP-421) 행을 주기적으로 정리한다.
 *
 * <p>발급 때 발급자의 만료 행을 지우지만, 다시 발급하지 않는 사용자의 행은 남는다. 그래서 1시간마다 만료 뒤 하루가 지난 행을 모든 테넌트에서 지운다.
 * staged_upload_link 는 FORCE RLS 테이블이라 테넌트를 순회하지 않고 SECURITY DEFINER 함수({@code
 * staged_upload_link_purge_expired}) 한 번으로 지운다 — 드라이브 전송 링크 정리({@code
 * DriveTransferLinkCleanupScheduler})와 같은 주기·잠금 관례. 올라온 파일 자체는 일반 만료 스윕({@link
 * FileCleanupService})이 지운다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class StagedUploadLinkCleanupScheduler {
  private final StagedUploadLinkRepository links;

  /** 시작 30초 후 첫 실행, 이후 1시간 간격. */
  @Scheduled(initialDelay = 30_000, fixedDelay = 3_600_000)
  @SchedulerLock(name = "StagedUploadLinkCleanupScheduler.purgeExpired")
  public void purgeExpired() {
    int deleted = links.purgeExpired();
    if (deleted > 0) {
      log.debug("만료된 staged_upload_link {}행 정리", deleted);
    }
  }
}
