package com.workplace.auth.service;

/** 비서 튜닝 디폴트(단일 출처). api 가 항상 값을 채워 compose 요청에 실어 보내므로 ai-agent 는 별도 디폴트를 두지 않는다. */
public final class AssistantDefaults {
  private AssistantDefaults() {}

  public static final String MODEL = "claude-sonnet-5";
  public static final String THINKING_DEPTH = "NORMAL"; // NONE | NORMAL | DEEP
  public static final int MAX_TURNS = 8;
  public static final int TIMEOUT_MS = 60_000;
}
