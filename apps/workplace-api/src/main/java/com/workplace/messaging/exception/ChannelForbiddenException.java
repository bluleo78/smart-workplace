package com.workplace.messaging.exception;

/** 채널 역할 권한 부족(이름변경/멤버관리/아카이브/역할변경 등). → 403. */
public class ChannelForbiddenException extends RuntimeException {
  public ChannelForbiddenException(long channelId, long userId, String action) {
    super(
        "채널에서 이 작업을 할 권한이 없습니다 (action: "
            + action
            + ", channelId: "
            + channelId
            + ", userId: "
            + userId
            + ")");
  }
}
