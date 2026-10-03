package com.workplace.watcher.outbound;

import java.time.Instant;

/** watcher 도메인 이벤트. 다른 모듈(chat 등) 이 구독해 멤버십 자동화 등에 사용. */
public final class WatcherDomainEvents {
  private WatcherDomainEvents() {}

  /**
   * 이슈 watcher 추가 직후. 진입점은 본인 구독({@code WatcherService.watch()}, actorUserId == userId)과 자동
   * 등록({@code WatcherAutoEnroller} — 이슈 생성·담당자 지정·댓글 작성, actorUserId 는 그 행위자라 담당자 지정 시 userId 와 다를
   * 수 있다).
   */
  public record WatcherAddedEvent(
      long issueId, long userId, long actorUserId, Instant occurredAt) {}
}
