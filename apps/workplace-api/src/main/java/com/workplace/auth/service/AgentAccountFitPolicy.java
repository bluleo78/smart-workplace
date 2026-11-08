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

  /**
   * 이 AI 에 등록하는 이 계정(provider)이 작업 공간 Pod 로 넘어가는가(WP-1410) — 실행 템플릿이 바로 그 계정을 요구하고 그 계정이 Pod 로 로그인
   * 정보를 넘기는 종류일 때 true. 그때만 등록이 Pod 가 받는 꼴을 따로 검사한다(기본·내 컴퓨터 방식의 기존 연결은 그대로 다시 등록할 수 있게).
   */
  boolean deliversToPod(long agentUserId, String provider);
}
