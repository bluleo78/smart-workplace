package com.workplace.auth.service;

/**
 * AI 키 이벤트 스트림을 닫을 일을 알리는 이벤트 모음(WP-2008). 커밋 뒤 {@link AgentKeyStreamCloser} 가 받아 이 파드의 열린 스트림을 닫는다
 * — 롤백된 폐기·삭제로 연결을 끊지 않도록.
 */
public final class AgentKeyStreamEvents {
  private AgentKeyStreamEvents() {}

  /** AI 키 하나가 폐기됐다 — 그 키로 연 스트림을 닫는다. */
  public record AgentKeyRevoked(long keyId) {}

  /**
   * AI 계정이 완전히 삭제됐다 — 그 AI 의 모든 스트림을 닫는다. user 모듈의 AgentDeleted(UserService) 와 이름을 달리해 import 를
   * 헷갈리지 않게 한다.
   */
  public record AgentStreamOwnerDeleted(long userId) {}
}
