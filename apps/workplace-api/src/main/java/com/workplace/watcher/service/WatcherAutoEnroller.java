package com.workplace.watcher.service;

import com.workplace.watcher.outbound.WatcherDomainEvents.WatcherAddedEvent;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

/** issue/comment 라이프사이클에서 호출되는 한 줄짜리 멱등 enroll 진입점. */
@Service
@RequiredArgsConstructor
public class WatcherAutoEnroller {

  private final IssueWatcherRepository repository;
  private final ApplicationEventPublisher eventPublisher;

  /**
   * userId 가 null 이면 no-op. INSERT ... ON CONFLICT DO NOTHING. 실제로 새로 등록됐을 때만 {@link
   * WatcherAddedEvent} 를 발행한다 — 직접 구독(WatcherService.watch)과 같은 이벤트라, 이미 열린 이슈 토크가 있으면 자동 구독자도 대화
   * 멤버로 추가된다(WP-213).
   *
   * @param actorUserId 등록을 일으킨 사용자(댓글 작성자·담당자 지정자 등)
   */
  public void enroll(Long issueId, Long userId, Long actorUserId) {
    if (userId == null) return;
    if (repository.add(issueId, userId)) {
      eventPublisher.publishEvent(
          new WatcherAddedEvent(issueId, userId, actorUserId, Instant.now()));
    }
  }
}
