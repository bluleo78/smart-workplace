package com.workplace.wiki.dto;

import com.workplace.fileai.security.dto.SecurityCheckView;

/**
 * 노트 HTML 블록 보안 점검 응답(WP-1290). 페이지에 스크립트가 든 HTML 소스가 없으면 hash null·blockCount 0·view null.
 *
 * @param hash 스크립트가 든 소스들의 지문(SHA-256 16진수 64자) — 화면은 자기가 계산한 지문과 같을 때만 이 결과를 믿는다
 * @param blockCount 스크립트가 든 소스 수(같은 소스도 각각 센다)
 * @param view 점검 상태 — 파일 점검과 같은 모양(행이 없으면 status null, AI 없으면 reason NO_AI)
 */
public record WikiHtmlScriptsCheckResponse(String hash, int blockCount, SecurityCheckView view) {

  /** 점검할 소스가 없는 페이지. */
  public static final WikiHtmlScriptsCheckResponse NONE =
      new WikiHtmlScriptsCheckResponse(null, 0, null);
}
