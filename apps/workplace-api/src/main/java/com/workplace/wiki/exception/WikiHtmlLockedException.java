package com.workplace.wiki.exception;

import lombok.Getter;

/**
 * 「HTML 문서」를 다른 사람이 편집 중이다(WP-1308) — 잠금을 쥔 사람이 저장·취소하거나 입력 없이 10분이 지날 때까지 편집 시작·원본 저장·다시
 * 올리기·되돌리기(사람·MCP·AI 모두)를 막는다. HTTP 409 — 응답 errors 에 code=HTML_LOCKED·holderName 을 실어 화면이 version
 * 충돌 409 와 가른다.
 */
@Getter
public class WikiHtmlLockedException extends RuntimeException {
  /** 응답 errors.code 값(도메인 오류 코드) — 화면이 이 409 를 알아본다. */
  public static final String CODE = "HTML_LOCKED";

  private final long holderId;
  private final String holderName;

  public WikiHtmlLockedException(long holderId, String holderName) {
    super(holderName + " 님이 편집 중입니다 — 저장되거나 편집이 끝날 때까지 이 HTML 문서를 바꿀 수 없습니다");
    this.holderId = holderId;
    this.holderName = holderName;
  }
}
