package com.workplace.wiki.dto;

/**
 * 노트 AI 요약 상태(WP-301).
 *
 * <ul>
 *   <li>READY — 요약이 있고 현재 버전으로 만든 것
 *   <li>STALE — 요약이 있지만 이후 노트가 바뀜(웹이 "다시 요약" 제공)
 *   <li>MISSING — 요약이 없고 본문이 충분히 길어 생성 대상(웹이 자동 생성)
 *   <li>TOO_SHORT — 요약이 없고 본문이 짧아 요약하지 않음(카드 비노출)
 * </ul>
 */
public enum WikiSummaryStatus {
  READY,
  STALE,
  MISSING,
  TOO_SHORT
}
