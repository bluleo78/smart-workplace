package com.workplace.auth.dto;

import java.util.List;

/**
 * Task10 — 모델 선택 옵션. id=저장/전송용 식별자(opencode 는 providerId/ 접두), label=표시명(anthropic 은 display_name,
 * 그 외 id 와 동일).
 *
 * <p>efforts(WP-1322) — 이 모델이 받는 「생각의 깊이」 단계(LOW·MEDIUM·HIGH·XHIGH·MAX 중, 낮은 순). null 이면 알 수 없음 —
 * 웹이 provider 별 기본(Claude 는 LOW~HIGH, OpenAI 호환은 「설정 안 함」만)으로 보인다. 빈 목록은 단계를 받지 않는 모델.
 */
public record ModelOption(String id, String label, List<String> efforts) {

  /** 지원 단계를 모르는 옵션(정적 폴백 목록·저장된 모델 덧붙이기 등). */
  public ModelOption(String id, String label) {
    this(id, label, null);
  }
}
