package com.workplace.global.util;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 채팅 본문(팀 채팅 message.body · 이슈 채팅 chat_message.body)의 마크다운 부분집합을 미리보기용 평문으로 바꾼다(WP-101).
 *
 * <p>웹 입력창이 만드는 부분집합만 다룬다 — {@code **굵게**}, {@code *기울임*}, {@code <u>밑줄</u>}, {@code ~~취소선~~},
 * {@code `코드`}, 펜스 코드 블록(```lang), 줄머리 목록 표시({@code - }·{@code * }·{@code 1. }), 링크 {@code
 * [글](url)}. 저장된 본문과 API 는 그대로 두고 푸시·대화 목록·홈 요약 같은 한 줄 미리보기에서만 기호를 지운다.
 *
 * <p>규칙:
 *
 * <ul>
 *   <li>강조 기호는 짝이 맞을 때만 지운다. 여는 기호 뒤·닫는 기호 앞은 공백이 아니어야 한다.
 *   <li>밑줄 {@code _} 는 강조로 보지 않는다 — {@code snake_case}·{@code a_b} 를 지키기 위해(입력창도 {@code *} 만 쓴다).
 *   <li>홑 {@code *} 는 바깥 이웃이 ASCII 영숫자면 강조가 아니다 — {@code 2*3*4}·URL 속 {@code a*b*c} 를 지킨다. 한글 이웃은
 *       허용({@code *기울임*을}).
 *   <li>코드(인라인·펜스) 안은 손대지 않는다. 닫히지 않은 펜스는 그냥 글자로 둔다.
 *   <li>{@code \*} 같은 역슬래시 이스케이프는 기호 자체로 풀고 강조 판정에서 뺀다.
 *   <li>멘션 토큰 {@code <@id>} 는 건드리지 않는다 — 호출부가 이름으로 바꾼다.
 * </ul>
 *
 * <p>구현: 지켜야 할 글자(이스케이프·코드 내용·링크 주소)를 사용자 영역(PUA) 문자로 잠시 바꿔 정규식이 못 보게 한 뒤 끝에서 되돌린다. 본문에 원래 있던 같은 범위
 * PUA 문자도 ASCII 로 바뀌지만 미리보기 용도라 무시한다.
 */
public final class ChatMarkdownText {

  private ChatMarkdownText() {}

  /** PUA 보호 기준점 — ASCII 문자 c 를 (BASE + c) 로 옮긴다. */
  private static final int PUA_BASE = 0xE000;

  /** 펜스 여는 줄 — ``` 뒤 언어 이름은 선택. */
  private static final Pattern FENCE_OPEN = Pattern.compile("^\\s*```[^`]*$");

  /** 펜스 닫는 줄. */
  private static final Pattern FENCE_CLOSE = Pattern.compile("^\\s*```\\s*$");

  /** 줄머리 목록 표시. 번호는 3자리까지 — {@code 2026. 10. 25.} 같은 날짜 줄을 목록으로 보지 않도록. */
  private static final Pattern LIST_MARKER = Pattern.compile("^\\s*(?:[-*+]|\\d{1,3}[.)])\\s+");

  /** 링크 {@code [글](url)} — url 안 괄호 한 겹까지 허용. */
  private static final Pattern LINK =
      Pattern.compile("\\[([^\\]\\n]*)\\]\\(((?:[^()\\s]|\\([^()\\s]*\\))+)\\)");

  private static final Pattern UNDERLINE_TAG = Pattern.compile("(?i)</?u>");
  private static final Pattern STRIKE = Pattern.compile("~~(?=\\S)(.+?)(?<=\\S)~~");
  private static final Pattern BOLD = Pattern.compile("\\*\\*(?=\\S)(.+?)(?<=\\S)\\*\\*");
  private static final Pattern ITALIC =
      Pattern.compile("(?<![A-Za-z0-9*])\\*(?=[^\\s*])(.+?)(?<=[^\\s*])\\*(?![A-Za-z0-9*])");

  /** 마크다운 부분집합을 평문으로. 줄바꿈은 유지한다(공백 접기·길이 자르기는 호출부 몫). null 은 빈 문자열. */
  public static String toPlain(String body) {
    if (body == null || body.isEmpty()) return "";
    String[] lines = body.replace("\r\n", "\n").split("\n", -1);
    List<String> out = new ArrayList<>(lines.length);
    int i = 0;
    while (i < lines.length) {
      if (FENCE_OPEN.matcher(lines[i]).matches()) {
        int close = findFenceClose(lines, i + 1);
        if (close > 0) {
          // 닫힌 펜스 — 펜스 줄만 빼고 내용 줄은 그대로.
          for (int k = i + 1; k < close; k++) out.add(lines[k]);
          i = close + 1;
          continue;
        }
      }
      out.add(inline(LIST_MARKER.matcher(lines[i]).replaceFirst("")));
      i++;
    }
    return String.join("\n", out);
  }

  private static int findFenceClose(String[] lines, int from) {
    for (int k = from; k < lines.length; k++) {
      if (FENCE_CLOSE.matcher(lines[k]).matches()) return k;
    }
    return -1;
  }

  /** 한 줄의 인라인 마크다운을 지운다 — 보호(이스케이프·코드) → 링크 → 밑줄 태그 → 취소선 → 굵게 → 기울임 → 복원. */
  private static String inline(String line) {
    String s = protectEscapesAndCode(line);
    s = replaceLinks(s);
    s = UNDERLINE_TAG.matcher(s).replaceAll("");
    s = STRIKE.matcher(s).replaceAll("$1");
    s = BOLD.matcher(s).replaceAll("$1");
    s = ITALIC.matcher(s).replaceAll("$1");
    return restore(s);
  }

  /**
   * 역슬래시 이스케이프({@code \*} → 보호된 {@code *})와 인라인 코드({@code `내용`} → 보호된 내용)를 처리한다. 코드 안의 역슬래시는 글자
   * 그대로다(CommonMark 와 같음). 짝 없는 백틱은 그냥 둔다.
   */
  private static String protectEscapesAndCode(String line) {
    StringBuilder sb = new StringBuilder(line.length());
    int n = line.length();
    int i = 0;
    while (i < n) {
      char c = line.charAt(i);
      if (c == '\\' && i + 1 < n && isAsciiPunct(line.charAt(i + 1))) {
        sb.append(protect(line.charAt(i + 1)));
        i += 2;
      } else if (c == '`') {
        int close = line.indexOf('`', i + 1);
        if (close > i + 1) {
          sb.append(protectAll(line.substring(i + 1, close)));
          i = close + 1;
        } else {
          sb.append(c);
          i++;
        }
      } else {
        sb.append(c);
        i++;
      }
    }
    return sb.toString();
  }

  /** 링크는 글만 남긴다. 글이 비면 주소(강조 판정에서 빠지도록 보호). */
  private static String replaceLinks(String s) {
    Matcher m = LINK.matcher(s);
    StringBuilder sb = new StringBuilder();
    while (m.find()) {
      String text = m.group(1);
      String shown = text.isBlank() ? protectAll(m.group(2)) : text;
      m.appendReplacement(sb, Matcher.quoteReplacement(shown));
    }
    m.appendTail(sb);
    return sb.toString();
  }

  private static boolean isAsciiPunct(char c) {
    return (c >= '!' && c <= '/')
        || (c >= ':' && c <= '@')
        || (c >= '[' && c <= '`')
        || (c >= '{' && c <= '~');
  }

  private static char protect(char c) {
    return isAsciiPunct(c) ? (char) (PUA_BASE + c) : c;
  }

  private static String protectAll(String s) {
    StringBuilder sb = new StringBuilder(s.length());
    for (int i = 0; i < s.length(); i++) sb.append(protect(s.charAt(i)));
    return sb.toString();
  }

  private static String restore(String s) {
    StringBuilder sb = new StringBuilder(s.length());
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      sb.append(c > PUA_BASE + ' ' && c <= PUA_BASE + '~' ? (char) (c - PUA_BASE) : c);
    }
    return sb.toString();
  }
}
