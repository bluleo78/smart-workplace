package com.workplace.wiki.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * 인에디터 /ai 액션. 와이어 포맷은 소문자(summarize|draft|continue) — 프론트 및 ai-agent zod 계약과 일치시킨다.
 *
 * <p>{@link JsonValue} 로 직렬화(소문자 → 에이전트 본문 전달), {@link JsonCreator} 로 역직렬화(대소문자 무관 바인딩)한다.
 */
public enum WikiAiAction {
  SUMMARIZE("summarize"),
  DRAFT("draft"),
  CONTINUE("continue");

  private final String wire;

  WikiAiAction(String wire) {
    this.wire = wire;
  }

  /** 직렬화 — 소문자 와이어 값으로 내보낸다(에이전트 zod enum 과 일치). */
  @JsonValue
  public String wire() {
    return wire;
  }

  /** 역직렬화 — 소문자/대문자 어떤 입력이든 관용적으로 바인딩한다. */
  @JsonCreator
  public static WikiAiAction from(String raw) {
    if (raw == null) {
      throw new IllegalArgumentException("action 은 필수입니다");
    }
    String v = raw.trim().toLowerCase();
    for (WikiAiAction a : values()) {
      if (a.wire.equals(v)) {
        return a;
      }
    }
    throw new IllegalArgumentException("알 수 없는 wiki ai action: " + raw);
  }
}
