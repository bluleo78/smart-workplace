package com.workplace.messaging.exception;

/** 채널 멤버가 아닌 사용자가 쓰기/조회를 시도. → 403. */
public class ChannelNotMemberException extends RuntimeException {
  public ChannelNotMemberException(long channelId, long userId) {
    super("채널에 참여하지 않은 사용자입니다 (channelId: " + channelId + ", userId: " + userId + ")");
  }
}
