package com.workplace.wiki.service;

import com.workplace.global.util.ChatMarkdownText;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.web.util.HtmlUtils;

/**
 * 노트 본문(마크다운 + HTML 혼합) → 사람이 읽는 글자만 남긴 평문(WP-1243). 검색 색인({@code wiki_page.search_text})·AI 요약
 * 입력·링크 미리보기가 모두 이 한 곳을 쓴다 — 쓰는 곳마다 따로 지우면 어떤 곳은 태그·CSS 가 남고 어떤 곳은 글자가 빠진다.
 *
 * <p>WP-1240·1242 뒤로 본문에는 마크다운 말고도 다음이 들어 있다. 글자로 보이지 않는 것은 지우고, 글자는 남긴다.
 *
 * <ul>
 *   <li>페이지 스타일 {@code <style data-wp-style>…</style>} — CSS 째 지운다(태그만 지우면 {@code .card{…}} 가 남는다).
 *       닫는 태그가 없으면(앞부분만 잘라 읽은 본문) 끝까지 지운다.
 *   <li>HTML 블록 {@code ```html-embed} 펜스 — 격리 iframe 에서 도는 HTML 문서 소스라 펜스째 지운다(소스의 태그·스크립트 글자가 검색에
 *       걸리지 않게). 닫는 펜스가 없으면 끝까지.
 *   <li>스타일 컨테이너 {@code <div class style>}·{@code <span>} 등 HTML 태그 — 태그만 지우고 안의 글자는 남긴다.
 *   <li>그 밖의 코드 블록 — 지금까지 검색이 본문 원문으로 코드 글자도 찾았으므로 펜스 줄만 빼고 내용은 남긴다.
 *   <li>마크다운 표기(제목·인용·표·구분선·이미지·할 일 상자·강조·링크) — 링크 미리보기({@link WikiPreviewText})가 하던 대로 지운다.
 *   <li>멘션 토큰 {@code <@id>}·{@code <#종류:id>}(칩 HTML·이스케이프 형태 포함) — 숫자 id 일 뿐 읽을 글자가 아니라 지운다(이름은
 *       화면에서 하이드레이션된다).
 * </ul>
 *
 * <p>공백은 접는다 — {@link #fromMarkdown} 은 한 줄로(검색·미리보기: 줄을 건너는 구절도 찾게), {@link
 * #fromMarkdownKeepingLines} 는 줄 구조를 남긴다(AI 요약: 문단 경계가 요약 품질에 도움이 된다).
 */
public final class WikiPlainText {

  private static final Pattern IMAGE = Pattern.compile("!\\[[^\\]\\n]*\\]\\([^)\\n]*\\)");
  private static final Pattern HEADING = Pattern.compile("(?m)^\\s{0,3}#{1,6}\\s+");
  private static final Pattern QUOTE = Pattern.compile("(?m)^\\s{0,3}>\\s?");
  private static final Pattern RULE = Pattern.compile("(?m)^\\s{0,3}([-*_])(\\s*\\1){2,}\\s*$");
  private static final Pattern TABLE_DIVIDER =
      Pattern.compile("(?m)^\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)*\\|?\\s*$");
  private static final Pattern TASK_BOX =
      Pattern.compile("(?m)^(\\s*(?:[-*+]|\\d{1,3}[.)])\\s+)\\[[ xX]\\]\\s+");

  /**
   * 글자로 보이지 않는 HTML 블록 — 스타일(WP-1240 페이지 스타일)·스크립트는 내용째 지운다. 본문이 잘려 닫는 태그가 없으면 끝까지 지운다(여러 줄·대소문자
   * 무시). 여는 태그 속성은 {@code <} 를 건너지 않는다 — 닫는 {@code >} 없는 {@code <style} 이 이어진 본문에서 시작점마다 끝까지 훑지
   * 않게(본문이 100만 자까지라 입력 길이에 선형이어야 한다).
   */
  private static final Pattern INVISIBLE_BLOCK =
      Pattern.compile("(?is)<(style|script)\\b[^<>]*>.*?(?:</\\1\\s*>|\\z)");

  /** HTML 주석 — 닫히지 않았으면 끝까지(브라우저도 그렇게 삼킨다). */
  private static final Pattern HTML_COMMENT = Pattern.compile("(?s)<!--.*?(?:-->|\\z)");

  /** HTML 태그 — 한 줄 안에서만, 태그 이름 바로 뒤가 공백·/·> 일 때만(본문의 {@code a<b}·{@code x > y} 비교식을 지우지 않게). */
  private static final Pattern HTML_TAG =
      Pattern.compile("</?[A-Za-z][A-Za-z0-9-]*(?:\\s[^<>\\n]*)?/?>");

  /**
   * {@link ChatMarkdownText} 가 펜스로 보지 못하고 남긴 펜스 줄 — 백틱 4개 이상·물결 펜스(바깥 펜스가 안쪽 백틱보다 길어진 코드 블록). 펜스
   * 표시만 있는 줄이라 글자가 아니다.
   */
  private static final Pattern LEFTOVER_FENCE =
      Pattern.compile("(?m)^[ \\t]*(?:`{3,}|~{3,})[^`\\n]*$");

  /**
   * 코드(펜스 코드 블록·인라인 코드) 속 {@code <} 를 잠시 바꿔 둘 글자(사용자 영역). 코드 예시의 {@code `<style>`}·{@code <!--} 가
   * 아래 HTML 규칙에 걸리면 닫는 태그가 없어 문서 끝까지 지워지고, 코드 속 태그 글자도 사라진다 — 코드 글자는 그대로 남긴다. HTML 규칙 뒤에 되돌린다.
   */
  private static final char CODE_LT = '\uE03C';

  /** 펜스 코드 블록 여는 줄 — 앞 공백·목록·인용 표시 뒤 백틱·물결 3개 이상(1=펜스). */
  private static final Pattern CODE_FENCE_OPEN =
      Pattern.compile("^[ \\t]*(?:(?:[>*+-]|\\d{1,9}[.)])[ \\t]*)*(`{3,}|~{3,})");

  /** 펜스 닫는 줄 앞의 들여쓰기·인용 표시. */
  private static final Pattern CODE_FENCE_CLOSE_PREFIX = Pattern.compile("^[ \\t]*(?:>[ \\t]*)*");

  /** 인라인 코드 — 한 줄 안에서 같은 수의 백틱으로 닫히는 구간. */
  private static final Pattern INLINE_CODE = Pattern.compile("(?<!`)(`+)(?!`)(.+?)(?<!`)\\1(?!`)");

  private static final Pattern SPACES = Pattern.compile("\\s+");

  /** 줄 안 공백(줄바꿈 제외) — 줄 구조를 남기는 변환에서 접는다. */
  private static final Pattern INLINE_SPACES = Pattern.compile("[ \\t\\x0B\\f\\r\\u00A0]+");

  /** 빈 줄 — 공백만 남은 줄과 연속 줄바꿈을 한 줄바꿈으로 접는다. */
  private static final Pattern BLANK_LINES = Pattern.compile("\\n(?:[ ]*\\n)+");

  private WikiPlainText() {}

  /** 본문 → 한 줄 평문(공백 하나로 접음). null·빈 본문은 빈 문자열. 검색 색인과 링크 미리보기용. */
  public static String fromMarkdown(String markdown) {
    return SPACES.matcher(strip(markdown)).replaceAll(" ").strip();
  }

  /** 본문 → 줄 구조를 남긴 평문(줄 안 공백은 하나로, 빈 줄은 접음). null·빈 본문은 빈 문자열. AI 요약 입력용. */
  public static String fromMarkdownKeepingLines(String markdown) {
    String s = INLINE_SPACES.matcher(strip(markdown)).replaceAll(" ");
    s = s.replace(" \n", "\n").replace("\n ", "\n");
    return BLANK_LINES.matcher(s).replaceAll("\n").strip();
  }

  /** 표기·태그를 지운 글자(공백은 아직 접지 않는다). */
  private static String strip(String markdown) {
    if (markdown == null || markdown.isBlank()) {
      return "";
    }
    // ① HTML 블록 펜스를 가장 먼저 지운다 — 소스 안의 <style>·# 주석·> 가 아래 규칙에 걸려 펜스 밖 글자까지 먹지 않게.
    String s = dropHtmlEmbeds(markdown.replace("\r\n", "\n"));
    // ①' 코드 속 꺾쇠는 숨긴다 — 코드 예시의 <style>·<!-- 가 아래 규칙에서 문서 끝까지 지우지 않게(⑤ 뒤에 되돌린다).
    s = protectCode(s);
    // ② 스타일·스크립트·주석은 내용째 — CSS 의 # · > · | 가 제목·인용·표 규칙에 걸리지 않게 다른 표기 정리보다 먼저.
    s = INVISIBLE_BLOCK.matcher(s).replaceAll(" ");
    s = HTML_COMMENT.matcher(s).replaceAll(" ");
    // ③ 노트에만 있는 블록 표기(링크 미리보기 WP-895 와 같은 규칙).
    s = IMAGE.matcher(s).replaceAll(" ");
    s = TABLE_DIVIDER.matcher(s).replaceAll("");
    s = RULE.matcher(s).replaceAll("");
    s = HEADING.matcher(s).replaceAll("");
    s = QUOTE.matcher(s).replaceAll("");
    s = TASK_BOX.matcher(s).replaceAll("$1");
    // ④ 태그는 떼고 안 글자는 남긴다(스타일 컨테이너·span). 멘션 칩 span 은 태그가 빠지고 안의 이스케이프 토큰이 ⑤에서 지워진다.
    s = HTML_TAG.matcher(s).replaceAll(" ");
    // ⑤ 멘션 토큰 — 숫자 id 라 글자가 아니다.
    s = WikiPublicMarkdownMasker.MENTION_TOKEN.matcher(s).replaceAll(" ");
    s = s.replace(CODE_LT, '<');
    // ⑥ 강조·코드·링크·목록 표시 — 채팅 미리보기 규칙에 맡긴다(코드 블록은 펜스 줄만 빠지고 내용은 남는다).
    s = ChatMarkdownText.toPlain(s).replace('|', ' ');
    s = LEFTOVER_FENCE.matcher(s).replaceAll("");
    // ⑦ 본문에 원래 있던 엔티티(&amp;amp; 등)는 글자로 푼다 — 태그를 지운 뒤라 &lt;div&gt; 같은 글자는 글자로 남는다.
    return HtmlUtils.htmlUnescape(s);
  }

  /**
   * 펜스 코드 블록 안과 인라인 코드 안의 {@code <} 를 {@link #CODE_LT} 로 바꾼다. 닫는 펜스가 없으면 문서 끝까지 코드다(CommonMark).
   */
  private static String protectCode(String s) {
    if (s.indexOf('<') < 0) {
      return s;
    }
    String[] lines = s.split("\n", -1);
    StringBuilder out = new StringBuilder(s.length());
    String fence = null; // 열린 펜스 표시(문자·길이) — null 이면 코드 블록 밖
    for (int i = 0; i < lines.length; i++) {
      String line = lines[i];
      if (i > 0) {
        out.append('\n');
      }
      if (fence != null) {
        if (isFenceClose(line, fence)) {
          fence = null;
          out.append(line);
        } else {
          out.append(line.replace('<', CODE_LT));
        }
        continue;
      }
      Matcher open = CODE_FENCE_OPEN.matcher(line);
      // 백틱 펜스의 정보 문자열에는 백틱이 없어야 한다(CommonMark) — ```코드``` 한 줄은 인라인 코드다.
      if (open.find() && !(open.group(1).charAt(0) == '`' && line.indexOf('`', open.end()) >= 0)) {
        fence = open.group(1);
        out.append(line);
        continue;
      }
      out.append(
          line.indexOf('`') < 0
              ? line
              : INLINE_CODE
                  .matcher(line)
                  .replaceAll(m -> Matcher.quoteReplacement(m.group().replace('<', CODE_LT))));
    }
    return out.toString();
  }

  /** 열린 펜스를 닫는 줄인지 — 같은 문자를 여는 펜스 길이 이상, 그 밖에는 공백뿐. */
  private static boolean isFenceClose(String line, String fence) {
    String t = CODE_FENCE_CLOSE_PREFIX.matcher(line).replaceFirst("").strip();
    return t.length() >= fence.length() && t.chars().allMatch(c -> c == fence.charAt(0));
  }

  /** HTML 블록(```html-embed) 을 펜스째 지운다. 판정은 공개 공유 가림과 같은 스캐너를 쓴다(목록·인용 안 펜스, 긴 펜스 포함). */
  private static String dropHtmlEmbeds(String md) {
    var fences = WikiPublicMarkdownMasker.htmlEmbedFences(md, true);
    if (fences.isEmpty()) {
      return md;
    }
    StringBuilder out = new StringBuilder(md.length());
    int last = 0;
    for (var f : fences) {
      out.append(md, last, f.start()).append('\n');
      last = f.end();
    }
    return out.append(md, last, md.length()).toString();
  }
}
