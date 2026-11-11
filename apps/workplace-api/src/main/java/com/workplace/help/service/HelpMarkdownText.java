package com.workplace.help.service;

import java.util.regex.Pattern;

/**
 * 매뉴얼 마크다운 → 검색·임베딩용 평문(WP-1509). 그림·링크 주소·절 표시·강조 기호를 걷어내 의미 있는 글만 남긴다. 조건 표기 {if 이름}·{/if} 는 지우고
 * 안의 글은 둔다 — 색인 본문·발췌에 표기가 실리지 않게(어느 조건이든 검색으로는 찾을 수 있어야 한다). {agent.username} 같은 자리표시는 건드리지
 * 않는다(도움말 화면이 나중에 채운다).
 */
public final class HelpMarkdownText {

  private static final Pattern IMAGE = Pattern.compile("!\\[[^\\]]*]\\([^)]*\\)(\\{[^}]*})?");
  private static final Pattern LINK = Pattern.compile("\\[([^\\]]*)]\\([^)]*\\)");
  private static final Pattern HELP_MARK = Pattern.compile("\\{help=[^}]*}");
  private static final Pattern CROP_MARK = Pattern.compile("\\{crop=[^}]*}");

  /** 조건 여는/닫는 표기 — `$`·`\` 바로 뒤 중괄호는 표기가 아니다(웹 helpMarkup.ts 와 같은 판정). */
  private static final Pattern CONDITION_MARK =
      Pattern.compile("(?<![$\\\\])\\{(?:if[ \\t]+[^{}\\s]+|/if)}");

  private static final Pattern HEADING = Pattern.compile("(?m)^\\s*#+\\s*");
  private static final Pattern H_SPACE = Pattern.compile("[ \\t]+");
  private static final Pattern BLANK_LINES = Pattern.compile("\\n\\s*\\n+");

  private HelpMarkdownText() {}

  /** 마크다운을 평문으로 바꾼다. null 은 빈 문자열. 빈 줄은 한 줄바꿈으로 합치고 줄 앞뒤 공백을 정리한다. */
  public static String toPlain(String markdown) {
    if (markdown == null) return "";
    String s = IMAGE.matcher(markdown).replaceAll("");
    s = LINK.matcher(s).replaceAll("$1");
    s = HELP_MARK.matcher(s).replaceAll("");
    s = CROP_MARK.matcher(s).replaceAll("");
    s = CONDITION_MARK.matcher(s).replaceAll("");
    s = HEADING.matcher(s).replaceAll("");
    s = s.replace("**", "").replace("`", "");
    // 줄마다 공백을 접고 앞뒤를 자른 뒤 빈 줄을 없앤다.
    StringBuilder sb = new StringBuilder();
    for (String line : s.split("\\R")) {
      String t = H_SPACE.matcher(line).replaceAll(" ").strip();
      if (t.isEmpty()) continue;
      if (sb.length() > 0) sb.append('\n');
      sb.append(t);
    }
    return sb.toString();
  }
}
