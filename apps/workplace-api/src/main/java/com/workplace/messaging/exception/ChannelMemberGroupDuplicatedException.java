package com.workplace.messaging.exception;

/** 이미 채널 멤버로 둔 부서를 다시 더하려 함(WP-1058). → 409 — 프로젝트 멤버 부서(WP-1057)와 같은 응답. */
public class ChannelMemberGroupDuplicatedException extends RuntimeException {
  public ChannelMemberGroupDuplicatedException() {
    super("이미 채널 멤버인 부서입니다");
  }
}
