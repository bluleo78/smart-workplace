package com.workplace.watcher.outbound;

import java.time.Instant;

/** watcher 도메인 이벤트. 다른 모듈(chat 등) 이 구독해 멤버십 자동화 등에 사용. */
public final class WatcherDomainEvents {
  private WatcherDomainEvents() {}

  /**
   * 이슈 watcher 추가 직후. 현재 진입점인 {@code WatcherService.watch()} 는 본인 self-watch 만 허용하므로 actorUserId ==
   * userId 가 항상 성립. 향후 관리자 대행 등 별도 진입점이 생길 경우에는 actorUserId 가 분기될 수 있다.
   */
  public record WatcherAddedEvent(
      long issueId, long userId, long actorUserId, Instant occurredAt) {}
}
