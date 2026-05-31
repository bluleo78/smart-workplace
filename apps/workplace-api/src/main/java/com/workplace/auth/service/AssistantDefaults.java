package com.workplace.auth.service;

/** 비서 튜닝 디폴트(단일 출처). ai-agent 의 DEFAULT_MODEL/MAX_TURNS/TIMEOUT 와 값이 일치해야 한다. */
public final class AssistantDefaults {
  private AssistantDefaults() {}

  public static final String MODEL = "claude-sonnet-4-6";
  public static final String THINKING_DEPTH = "NORMAL"; // NONE | NORMAL | DEEP
  public static final int MAX_TURNS = 8;
  public static final int TIMEOUT_MS = 60_000;
}
