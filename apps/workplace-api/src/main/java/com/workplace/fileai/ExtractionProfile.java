package com.workplace.fileai;

/**
 * 추출 프로파일(WP-242) — 텍스트 추출 이후 어디까지 처리할지.
 *
 * <p>FULL: 드라이브 파일 — 추출 → AI 요약 → 임베딩(검색). TEXT_ONLY: 첨부 — 에이전트가 글자를 읽기만 하면 되므로 요약·임베딩 비용을 쓰지 않는다.
 */
public enum ExtractionProfile {
  FULL,
  TEXT_ONLY
}
