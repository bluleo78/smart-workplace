package com.workplace.messaging.exception;

/** 아카이브된 채널에 메시지 전송/수정 시도. → 409. */
public class ChannelArchivedException extends RuntimeException {
  public ChannelArchivedException(long channelId) {
    super("channel " + channelId + " is archived");
  }
}
