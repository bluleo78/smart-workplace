package com.workplace.messaging.exception;

/** 채널 멤버가 아닌 사용자가 쓰기/조회를 시도. → 403. */
public class ChannelNotMemberException extends RuntimeException {
  public ChannelNotMemberException(long channelId, long userId) {
    super("user " + userId + " is not a member of channel " + channelId);
  }
}
