package com.workplace.auth.service;

/**
 * AI 계정이 그 AI 의 지금 실행 방식에 맞는지 확인하는 규칙(WP-1296·1297) — 실행 방식(기본·작업 공간·내 컴퓨터)은 agentruntime 모듈이 알므로
 * auth 는 이 인터페이스만 보고, 구현은 agentruntime 이 둔다(auth 가 agentruntime 을 import 하지 않게).
 */
public interface AgentAccountFitPolicy {

  /**
   * 이 AI 에 이 계정(provider)을 연결해도 되는지 — 맞지 않으면 {@link
   * com.workplace.auth.exception.InvalidProviderCredentialException}(400, 한국어 문구)을 던진다.
   */
  void requireFits(long agentUserId, String provider);
}
