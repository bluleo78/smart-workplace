package com.workplace.wiki.service;

import com.workplace.global.util.Texts;

/**
 * 노트 본문(마크다운) → 링크 미리보기용 한 줄 평문(WP-895). 공유 카드 설명에 쓰므로 서식 기호·이미지·표 구분자를 지우고 공백을 접어 앞부분만 남긴다.
 *
 * <p>글자 추출은 검색 색인·AI 요약과 같은 {@link WikiPlainText} 에 맡긴다(WP-1243) — 페이지 스타일 CSS·HTML 블록 소스·태그가 설명에
 * 새지 않는다. 여기서는 길이만 자른다.
 */
final class WikiPreviewText {

  /** 읽어 올 본문 앞부분 상한 — 설명은 앞 160자만 쓰므로 긴 노트 전체를 읽고 가리지 않는다(DB 에서 자른다). */
  static final int SOURCE_LIMIT = 4000;

  /** 미리보기 설명 최대 글자 수 — 카카오톡·Slack 카드가 두세 줄로 자르는 길이보다 조금 길게. */
  static final int MAX_LENGTH = 160;

  private WikiPreviewText() {}

  /** 본문 앞부분 평문 — 비면 빈 문자열, 길면 {@link #MAX_LENGTH} 에서 자르고 「…」. */
  static String excerpt(String markdown) {
    String s = WikiPlainText.fromMarkdown(markdown);
    // 넘칠 때만 자르고, 「…」까지 MAX_LENGTH 안에 들게 한 글자 덜 남긴다.
    return s.codePointCount(0, s.length()) <= MAX_LENGTH
        ? s
        : Texts.truncateCodePoints(s, MAX_LENGTH - 1);
  }
}
