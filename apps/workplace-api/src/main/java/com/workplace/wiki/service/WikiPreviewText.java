package com.workplace.wiki.service;

import com.workplace.global.util.ChatMarkdownText;
import com.workplace.global.util.Texts;
import java.util.regex.Pattern;
import org.springframework.web.util.HtmlUtils;

/**
 * 노트 본문(마크다운) → 링크 미리보기용 한 줄 평문(WP-895). 공유 카드 설명에 쓰므로 서식 기호·이미지·표 구분자를 지우고 공백을 접어 앞부분만 남긴다.
 *
 * <p>채팅 미리보기용 {@link ChatMarkdownText} 가 강조·코드·링크·목록을 다루므로, 노트에만 있는 블록 표기(제목 #·인용
 * &gt;·표·구분선·이미지·HTML 태그)를 먼저 지운 뒤 그것에 맡긴다.
 */
final class WikiPreviewText {

  /** 읽어 올 본문 앞부분 상한 — 설명은 앞 160자만 쓰므로 긴 노트 전체를 읽고 가리지 않는다(DB 에서 자른다). */
  static final int SOURCE_LIMIT = 4000;

  /** 미리보기 설명 최대 글자 수 — 카카오톡·Slack 카드가 두세 줄로 자르는 길이보다 조금 길게. */
  static final int MAX_LENGTH = 160;

  private static final Pattern IMAGE = Pattern.compile("!\\[[^\\]\\n]*\\]\\([^)\\n]*\\)");
  private static final Pattern HEADING = Pattern.compile("(?m)^\\s{0,3}#{1,6}\\s+");
  private static final Pattern QUOTE = Pattern.compile("(?m)^\\s{0,3}>\\s?");
  private static final Pattern RULE = Pattern.compile("(?m)^\\s{0,3}([-*_])(\\s*\\1){2,}\\s*$");
  private static final Pattern TABLE_DIVIDER =
      Pattern.compile("(?m)^\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)*\\|?\\s*$");
  private static final Pattern TASK_BOX =
      Pattern.compile("(?m)^(\\s*(?:[-*+]|\\d{1,3}[.)])\\s+)\\[[ xX]\\]\\s+");

  /**
   * 페이지 스타일 블록(WP-1240 {@code <style data-wp-style>…</style>}) — 태그만 지우면 안의 CSS 글자가 설명에 남으므로 내용째
   * 지운다. 본문은 {@link #SOURCE_LIMIT} 에서 잘려 오므로 닫는 태그가 없으면 끝까지 지운다(여러 줄·대소문자 무시).
   */
  private static final Pattern STYLE_BLOCK =
      Pattern.compile("(?is)<style\\b[^>]*>.*?(?:</style\\s*>|\\z)");

  /** HTML 태그 — 한 줄 안에서만, 태그 이름 바로 뒤가 공백·/·> 일 때만(본문의 {@code a<b}·{@code x > y} 비교식을 지우지 않게). */
  private static final Pattern HTML_TAG =
      Pattern.compile("</?[A-Za-z][A-Za-z0-9-]*(?:\\s[^<>\\n]*)?/?>");

  private static final Pattern SPACES = Pattern.compile("\\s+");

  private WikiPreviewText() {}

  /** 본문 앞부분 평문 — 비면 빈 문자열, 길면 {@link #MAX_LENGTH} 에서 자르고 「…」. */
  static String excerpt(String markdown) {
    if (markdown == null || markdown.isBlank()) {
      return "";
    }
    // 페이지 스타일 CSS 는 다른 표기 정리보다 먼저 지운다 — CSS 의 # · > · | 가 제목·인용·표 규칙에 걸리지 않게.
    String s = STYLE_BLOCK.matcher(markdown).replaceAll(" ");
    s = IMAGE.matcher(s).replaceAll(" ");
    s = TABLE_DIVIDER.matcher(s).replaceAll("");
    s = RULE.matcher(s).replaceAll("");
    s = HEADING.matcher(s).replaceAll("");
    s = QUOTE.matcher(s).replaceAll("");
    s = TASK_BOX.matcher(s).replaceAll("$1");
    s = HTML_TAG.matcher(s).replaceAll(" ");
    s = ChatMarkdownText.toPlain(s).replace('|', ' ');
    // 본문에 원래 있던 엔티티(&amp;amp; 등)는 글자로 풀어 둔다 — 메타에 넣을 때 한 번만 이스케이프되게.
    s = HtmlUtils.htmlUnescape(s);
    s = SPACES.matcher(s).replaceAll(" ").strip();
    // 넘칠 때만 자르고, 「…」까지 MAX_LENGTH 안에 들게 한 글자 덜 남긴다.
    return s.codePointCount(0, s.length()) <= MAX_LENGTH
        ? s
        : Texts.truncateCodePoints(s, MAX_LENGTH - 1);
  }
}
