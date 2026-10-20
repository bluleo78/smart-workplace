package com.workplace.messaging.exception;

/** 아카이브된 채널에 쓰기 시도. → 409. 기본 문구는 메시지 전송/수정용, 이름 변경·초대·참여는 막힌 동작에 맞춘 문구를 넘긴다(WP-621). */
public class ChannelArchivedException extends RuntimeException {
  public ChannelArchivedException(long channelId) {
    this(channelId, "보관된 채널에서는 메시지를 보내거나 수정할 수 없습니다");
  }

  public ChannelArchivedException(long channelId, String message) {
    super(message);
  }
}
