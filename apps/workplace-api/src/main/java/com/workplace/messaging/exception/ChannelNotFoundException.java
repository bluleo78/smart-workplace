package com.workplace.messaging.exception;

/** 존재하지 않는 채널 접근. → 404. */
public class ChannelNotFoundException extends RuntimeException {
  public ChannelNotFoundException(long channelId) {
    super("채널을 찾을 수 없습니다 (id: " + channelId + ")");
  }
}
