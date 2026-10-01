package com.workplace.mail.util;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.web.util.HtmlUtils;

/**
 * 메일 본문에서 "새로 쓴 부분"만 남기는 공용 추출기(WP-149). 원본 분석(③)·개인 분석(④)·요약 상태 판정이 같은 결과를 쓴다.
 *
 * <p>왜: 분류·요약 입력이 본문 앞부분(미리보기)뿐이면 인사말에 묻히고, 전체 본문이면 인용된 이전 메일까지 읽어 "나에게 온 요청"을 잘못 판단한다. 첫 인용 표시와 서명
 * 구분선 뒤를 자르고, 끝의 요청·기한이 살아남도록 길면 앞+뒤만 남긴다.
 *
 * <p>HTML 은 {@link MailBodyText#stripHtml} 처럼 공백을 한 줄로 뭉개면 줄 단위 규칙(`>`·`-- `·헤더 블록)을 쓸 수 없으므로, 인용
 * 블록 태그에서 먼저 자른 뒤 줄바꿈을 살려 평문화한다.
 */
public final class NewContentExtractor {

  /** 새 본문 상한. 넘으면 앞 {@link #HEAD_CHARS} + "…" + 뒤 {@link #TAIL_CHARS}. */
  public static final int MAX_CHARS = 2_500;

  static final int HEAD_CHARS = 1_500;
  static final int TAIL_CHARS = 1_000;
  static final String ELLIPSIS = "…";

  /** HTML 인용 블록 시작(Outlook divRplyFwdMsg · Gmail gmail_quote · Apple Mail blockquote type=cite). */
  private static final List<Pattern> HTML_QUOTE_STARTS =
      List.of(
          Pattern.compile("<div[^>]*\\bid\\s*=\\s*[\"']?divRplyFwdMsg", Pattern.CASE_INSENSITIVE),
          Pattern.compile(
              "<div[^>]*\\bclass\\s*=\\s*[\"'][^\"']*\\bgmail_quote", Pattern.CASE_INSENSITIVE),
          Pattern.compile("<blockquote[^>]*\\btype\\s*=\\s*[\"']?cite", Pattern.CASE_INSENSITIVE));

  private static final Pattern ORIGINAL_MESSAGE =
      Pattern.compile("^-{2,}\\s*(original message|원본 메시지)\\s*-{2,}$", Pattern.CASE_INSENSITIVE);
  private static final Pattern ON_WROTE =
      Pattern.compile("^On\\s.+\\bwrote:$", Pattern.CASE_INSENSITIVE);
  private static final Pattern KO_WROTE = Pattern.compile("^.+님이 작성:$");
  private static final Pattern HEADER_FROM =
      Pattern.compile("^(from|보낸 사람|보낸사람)\\s*:.*", Pattern.CASE_INSENSITIVE);

  /** 헤더 블록 확정에 필요한 "강한" 후속 헤더. to/cc/date 만으로는 일정표("From: 10:00 / To: 11:00")와 구분되지 않는다. */
  private static final Pattern HEADER_STRONG =
      Pattern.compile("^(sent|subject|보낸 날짜|제목)\\s*:.*", Pattern.CASE_INSENSITIVE);

  /** From 줄 뒤 이 줄 수 안에 다른 헤더 줄이 있어야 헤더 블록으로 본다("From: our team…" 같은 본문 줄 오판 방지). */
  private static final int HEADER_LOOKAHEAD = 4;

  private NewContentExtractor() {}

  /**
   * 새로 쓴 부분을 돌려준다. 평문 본문이 있으면 평문, 없으면 HTML 을 쓴다. 잘라서 비면 원래 본문, 원래 본문도 비면 미리보기. 결과는 상한 적용.
   *
   * @param bodyText BODY_TEXT(없을 수 있음)
   * @param bodyHtml BODY_HTML(없을 수 있음)
   * @param snippet 미리보기(마지막 폴백)
   */
  public static String extract(String bodyText, String bodyHtml, String snippet) {
    boolean hasText = bodyText != null && !bodyText.isBlank();
    String original = hasText ? normalize(bodyText).strip() : htmlToLines(bodyHtml);
    String cut = hasText ? cutQuoted(original) : cutQuoted(htmlToLines(cutHtmlQuote(bodyHtml)));
    String result;
    if (!cut.isBlank()) {
      result = cut;
    } else if (!original.isBlank()) {
      result = original;
    } else {
      result = snippet == null ? "" : snippet.strip();
    }
    return cap(result);
  }

  /** 줄 단위 인용·서명 규칙으로 첫 인용 지점 앞까지만 남긴다. */
  static String cutQuoted(String text) {
    String[] lines = text.split("\n", -1);
    int cut = lines.length;
    for (int i = 0; i < lines.length; i++) {
      if (isQuoteStart(lines, i)) {
        cut = i;
        break;
      }
    }
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < cut; i++) {
      if (i > 0) {
        sb.append('\n');
      }
      sb.append(lines[i]);
    }
    return sb.toString().strip();
  }

  /** i 번째 줄이 인용(또는 서명) 시작인지. */
  private static boolean isQuoteStart(String[] lines, int i) {
    String raw = lines[i];
    String line = raw.strip();
    if (raw.stripTrailing().equals("--")) {
      return true; // 서명 구분선 "-- "
    }
    if (line.startsWith(">")) {
      return true; // ">" 인용 줄 묶음의 시작
    }
    if (ORIGINAL_MESSAGE.matcher(line).matches()
        || ON_WROTE.matcher(line).matches()
        || KO_WROTE.matcher(line).matches()) {
      return true;
    }
    // Gmail 이 "On … <a@b>" / "wrote:" 로 줄을 나누는 경우
    if (line.regionMatches(true, 0, "On ", 0, 3)
        && i + 1 < lines.length
        && ON_WROTE.matcher(line + " " + lines[i + 1].strip()).matches()) {
      return true;
    }
    return HEADER_FROM.matcher(line).matches() && hasHeaderFollower(lines, i);
  }

  /** From 줄 다음 몇 줄 안에 Sent/To/제목 등 다른 헤더 줄이 있는지. */
  private static boolean hasHeaderFollower(String[] lines, int fromIndex) {
    int end = Math.min(lines.length, fromIndex + 1 + HEADER_LOOKAHEAD);
    for (int j = fromIndex + 1; j < end; j++) {
      if (HEADER_STRONG.matcher(lines[j].strip()).matches()) {
        return true;
      }
    }
    return false;
  }

  /** HTML 인용 블록 태그가 처음 나오는 곳 앞까지 자른다. 없으면 그대로. */
  static String cutHtmlQuote(String html) {
    if (html == null) {
      return null;
    }
    int min = html.length();
    for (Pattern p : HTML_QUOTE_STARTS) {
      Matcher m = p.matcher(html);
      if (m.find()) {
        min = Math.min(min, m.start());
      }
    }
    return html.substring(0, min);
  }

  /** HTML → 줄바꿈을 살린 평문. 블록 태그·br 은 줄바꿈, 나머지 태그는 공백, 엔티티 디코드, 줄마다 공백 정리. */
  static String htmlToLines(String html) {
    if (html == null || html.isBlank()) {
      return "";
    }
    String s =
        html.replaceAll("(?is)<(style|script|head)\\b[^>]*>.*?</\\1\\s*>", " ")
            .replaceAll("(?s)<!--.*?-->", " ")
            .replaceAll("(?i)<br\\s*/?>", "\n")
            .replaceAll("(?i)</(p|div|tr|li|h[1-6]|blockquote|table)\\s*>", "\n")
            .replaceAll("(?s)<[^>]+>", " ");
    s = HtmlUtils.htmlUnescape(s).replace('\u00A0', ' ');
    StringBuilder out = new StringBuilder();
    for (String line : s.split("\r?\n", -1)) {
      out.append(line.replaceAll("[ \\t]+", " ").strip()).append('\n');
    }
    return out.toString().replaceAll("\n{3,}", "\n\n").strip();
  }

  /** CRLF·CR → LF. */
  private static String normalize(String text) {
    return text.replace("\r\n", "\n").replace('\r', '\n');
  }

  /** 상한 초과 시 앞+뒤만 남긴다 — 끝의 요청·기한 보존. */
  static String cap(String s) {
    if (s.length() <= MAX_CHARS) {
      return s;
    }
    return s.substring(0, HEAD_CHARS) + ELLIPSIS + s.substring(s.length() - TAIL_CHARS);
  }
}
