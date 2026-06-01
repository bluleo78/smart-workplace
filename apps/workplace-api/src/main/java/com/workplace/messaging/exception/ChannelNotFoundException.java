package com.workplace.messaging.exception;

/** 존재하지 않는 채널 접근. → 404. */
public class ChannelNotFoundException extends RuntimeException {
  public ChannelNotFoundException(long channelId) {
    super("channel " + channelId + " not found");
  }
}
