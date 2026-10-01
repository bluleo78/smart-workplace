package com.workplace.mail.dto;

/**
 * 메일 요약 표시 상태(WP-149). READY: 요약 카드. SKIPPED: 요약을 생략함 — "AI 요약" 버튼(누를 때만 생성). EMPTY: 보여 줄 요약
 * 없음(시도했으나 결과 없음, 또는 짧아서 생략 — 버튼도 숨김).
 */
public enum MailSummaryStatus {
  READY,
  SKIPPED,
  EMPTY
}
