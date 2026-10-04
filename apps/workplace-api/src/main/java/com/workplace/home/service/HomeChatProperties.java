package com.workplace.home.service;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 메인 AI 채팅 맥락 설정(WP-232). contextTokenBudget 은 ai-agent 로 넘기는 "누적 요약 + 원문 이력" 의 근사 토큰 하드 상한이다 —
 * 컨텍스트가 작은 모델을 붙일 때 이 값만 낮춘다. 나머지 임계는 비율로 파생한다.
 */
@ConfigurationProperties("workplace.home.chat")
public record HomeChatProperties(Integer contextTokenBudget) {

  /** 미설정·비정상 값이면 128k(일반적인 256k 컨텍스트 모델의 절반 — 시스템 프롬프트·도구 결과 여유). */
  public HomeChatProperties {
    if (contextTokenBudget == null || contextTokenBudget <= 0) contextTokenBudget = 128_000;
  }

  /** 턴 종료 후 비동기 요약을 예약하는 임계(75%). */
  public int summarizeTrigger() {
    return contextTokenBudget * 3 / 4;
  }

  /** 요약 후 원문을 이 크기 이하로 남긴다(50%) — 요약이 매 턴 돌지 않게 하는 여유폭. */
  public int summarizeTarget() {
    return contextTokenBudget / 2;
  }

  /** 메시지 1건(및 요약 본문) 상한(25%) — 거대한 단일 메시지가 예산을 독점하지 않게. */
  public int perMessageCap() {
    return contextTokenBudget / 4;
  }
}
