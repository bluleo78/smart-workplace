package com.workplace.mail.dto;

/**
 * email_content 를 만든 수신 경로(WP-130 공유 지문의 첫 요소). 경로가 다르면 본문 표현(원본 MIME vs Graph 변환 HTML)과 첨부 ordinal
 * 이 달라 서로 공유하지 않는다.
 */
public enum ContentSource {
  /** IMAP 동기화 — 헤더 + BODYSTRUCTURE 요약으로 지문을 만든다. */
  IMAP,
  /** Microsoft Graph 동기화 — 본문 구조를 알 수 없어 헤더만으로 지문을 만든다. */
  GRAPH,
  /** 로컬에서 작성해 보낸 메일(보낸편지함 행). */
  SENT
}
