package com.workplace.messaging.exception;

/** AGENT(AI 봇) 사용자를 채널 OWNER 로 승격 시도 — 사람 전용 권한. → 409. */
public class AgentCannotOwnChannelException extends RuntimeException {
  public AgentCannotOwnChannelException(long channelId, long targetUserId) {
    super("AI 에이전트는 채널 소유자가 될 수 없습니다 (channelId: " + channelId + ", userId: " + targetUserId + ")");
  }
}
