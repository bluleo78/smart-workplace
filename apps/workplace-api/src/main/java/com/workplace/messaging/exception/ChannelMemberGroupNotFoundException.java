package com.workplace.messaging.exception;

/** 이 채널의 멤버 부서가 아닌 부서를 빼려 함(WP-1058). → 404. */
public class ChannelMemberGroupNotFoundException extends RuntimeException {
  public ChannelMemberGroupNotFoundException() {
    super("채널 멤버 부서를 찾을 수 없습니다");
  }
}
