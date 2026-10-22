package com.workplace.watcher.service;

import com.workplace.project.dto.ProjectRow;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.watcher.outbound.WatcherDomainEvents.WatcherAddedEvent;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

/**
 * watcher 등록 + WatcherAddedEvent 발행의 단일 진입점. 본인 구독(WatcherService.watch)과 issue/comment 자동 등록이 함께
 * 쓴다.
 */
@Service
@RequiredArgsConstructor
public class WatcherAutoEnroller {

  private final IssueWatcherRepository repository;
  private final ApplicationEventPublisher eventPublisher;
  private final ProjectAccessGuard accessGuard;

  /**
   * userId 가 null 이면 no-op. INSERT ... ON CONFLICT DO NOTHING. 실제로 새로 등록됐을 때만 {@link
   * WatcherAddedEvent} 를 발행한다 — 직접 구독(WatcherService.watch)과 같은 이벤트라, 이미 열린 이슈 토크가 있으면 자동 구독자도 대화
   * 멤버로 추가된다(WP-213).
   *
   * <p>등록할 사람이 그 프로젝트를 볼 수 있을 때만 넣는다 — 멤버라서 볼 수 있으면 그 멤버 행을 커밋까지 잠가, 같은 순간의 멤버 제거가 이 등록을 정리하거나 (이쪽이
   * 먼저) 이 등록이 빠지게(제거가 먼저) 한다(WP-776). 잠그지 않으면 제거 뒤 워처 정리(WP-476)를 피한 워처가 남아 알림이 계속 간다.
   *
   * @param project 이슈가 속한 프로젝트
   * @param actorUserId 등록을 일으킨 사용자(댓글 작성자·담당자 지정자 등)
   * @return 새로 등록됐으면 true(이미 watcher 였거나 userId 가 null 이거나 볼 수 없으면 false)
   */
  public boolean enroll(ProjectRow project, Long issueId, Long userId, Long actorUserId) {
    if (userId == null || !accessGuard.lockReadable(project, userId)) return false;
    boolean inserted = repository.add(issueId, userId);
    if (inserted) {
      eventPublisher.publishEvent(
          new WatcherAddedEvent(issueId, userId, actorUserId, Instant.now()));
    }
    return inserted;
  }
}
