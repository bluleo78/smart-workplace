package com.workplace.auth.service;

/** 비서 튜닝 디폴트(단일 출처). api 가 항상 값을 채워 compose 요청에 실어 보내므로 ai-agent 는 별도 디폴트를 두지 않는다. */
public final class AssistantDefaults {
  private AssistantDefaults() {}

  public static final String MODEL = "claude-sonnet-5-5";

  /**
   * 생각의 깊이 기본값 — DEFAULT 는 「설정 안 함」(모델 기본 추론 노력, ai-agent 가 effort·variant 를 싣지 않음). 값 집합은 DEFAULT
   * | LOW | MEDIUM | HIGH | XHIGH | MAX(WP-1322, {@link ThinkingDepths#PATTERN}).
   */
  public static final String THINKING_DEPTH = "DEFAULT";

  public static final int MAX_TURNS = 8;
  public static final int TIMEOUT_MS = 60_000;
}
