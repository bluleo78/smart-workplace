package com.workplace.messaging.exception;

/** 아카이브된 채널에 메시지 전송/수정 시도. → 409. */
public class ChannelArchivedException extends RuntimeException {
  public ChannelArchivedException(long channelId) {
    super("보관된 채널에서는 메시지를 보내거나 수정할 수 없습니다 (channelId: " + channelId + ")");
  }
}
