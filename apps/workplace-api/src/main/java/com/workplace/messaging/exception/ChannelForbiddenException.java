package com.workplace.messaging.exception;

/** 채널 역할 권한 부족(이름변경/멤버관리/아카이브/역할변경 등). → 403. */
public class ChannelForbiddenException extends RuntimeException {
  public ChannelForbiddenException(long channelId, long userId, String action) {
    // 토스트로 그대로 보이는 문구라 action·channelId·userId 같은 내부 값은 싣지 않는다(WP-510).
    super("채널에서 이 작업을 할 권한이 없습니다");
  }
}
