package com.workplace.messaging.exception;

/** AGENT(AI 봇) 사용자를 채널 OWNER 로 승격 시도 — 사람 전용 권한. → 409. */
public class AgentCannotOwnChannelException extends RuntimeException {
  public AgentCannotOwnChannelException(long channelId, long targetUserId) {
    super("agent user " + targetUserId + " cannot own channel " + channelId);
  }
}
