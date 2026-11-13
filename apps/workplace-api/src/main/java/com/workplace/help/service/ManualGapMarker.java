package com.workplace.help.service;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 답변 끝의 「매뉴얼 보강」 표식(manual-gap: 링크) 판정(WP-1512). 웹 helpAnswer.ts splitFooterOf 와 같은 규칙이라, 사용자 화면에
 * 꼬리줄로 보이는 답만 공백으로 센다.
 */
public final class ManualGapMarker {

  private ManualGapMarker() {}

  /** help:/manual-gap: 링크 한 개(소문자 스킴만). */
  private static final Pattern LINK =
      Pattern.compile("\\[[^\\]]*\\]\\((help:[^)\\s]*|manual-gap:[^)\\s]*)\\)");

  /** 빈 줄(공백만 있는 줄 포함) 기준 문단 분리. */
  private static final Pattern PARAGRAPH_BREAK = Pattern.compile("\\n\\s*\\n");

  /** 목록·인용·제목·코드 펜스로 시작하는 문단 — 꼬리줄이 될 수 없다. */
  private static final Pattern BLOCK_START =
      Pattern.compile("^(```|#|>|-|\\*|\\d+\\.).*", Pattern.DOTALL);

  /** 링크를 걷어낸 나머지로 허용되는 것 — 공백과 가운뎃점뿐. */
  private static final Pattern ONLY_SEPARATORS = Pattern.compile("[\\s·]*");

  /** 마지막 비어 있지 않은 문단이 help:/manual-gap: 링크로만 이뤄지고 manual-gap: 가 하나 이상이면 true. */
  public static boolean endsWithGap(String markdown) {
    // 대부분의 답은 표식 문자열 자체가 없다 — 문단·줄 분리 전에 바로 거른다.
    if (markdown == null || markdown.indexOf("manual-gap:") < 0 || markdown.isBlank()) {
      return false;
    }
    // 코드 펜스가 열린 채 끝나면(펜스 줄 수가 홀수) 표식은 코드 안이다.
    long fences = markdown.lines().filter(l -> l.startsWith("```")).count();
    if (fences % 2 == 1) {
      return false;
    }
    String last = lastParagraph(markdown);
    if (last == null) {
      return false;
    }
    // 빈 줄 없이 붙은 제목·닫힌 코드 펜스 뒤 줄은 웹 파서(mdast)에서 별도 문단이라, 그 블록을 떼고 남은 줄로 판정한다.
    last = dropLeadingSingleBlocks(last);
    if (last.isEmpty() || BLOCK_START.matcher(last).matches()) {
      return false;
    }
    Matcher m = LINK.matcher(last);
    boolean gap = false;
    while (m.find()) {
      if (m.group(1).startsWith("manual-gap:")) {
        gap = true;
      }
    }
    // 링크를 지운 나머지가 공백·가운뎃점뿐이어야 한다(다른 글이 섞이면 꼬리줄이 아니다).
    String rest = LINK.matcher(last).replaceAll("");
    return gap && ONLY_SEPARATORS.matcher(rest).matches();
  }

  /**
   * 문단 앞머리의 ATX 제목 줄(# …)과 닫힌 코드 펜스(``` … ```)를 걷어 낸 나머지. 둘 다 빈 줄 없이 다음 줄과 붙어도 마크다운에서는 따로 끝나는 블록이라,
   * 웹 splitFooterOf 가 보는 「마지막 문단」과 맞추려는 것이다. 목록·인용은 다음 줄을 이어 붙이므로(게으른 연속) 걷지 않는다.
   */
  private static String dropLeadingSingleBlocks(String paragraph) {
    String rest = paragraph;
    while (true) {
      if (rest.startsWith("#")) {
        int nl = rest.indexOf('\n');
        rest = nl < 0 ? "" : rest.substring(nl + 1).strip();
      } else if (rest.startsWith("```")) {
        int open = rest.indexOf('\n');
        int close = open < 0 ? -1 : rest.indexOf("\n```", open);
        if (close < 0) {
          return rest;
        }
        int nl = rest.indexOf('\n', close + 1);
        rest = nl < 0 ? "" : rest.substring(nl + 1).strip();
      } else {
        return rest;
      }
    }
  }

  /** 비어 있지 않은 마지막 문단(없으면 null). */
  private static String lastParagraph(String markdown) {
    String[] parts = PARAGRAPH_BREAK.split(markdown.strip());
    for (int i = parts.length - 1; i >= 0; i--) {
      if (!parts[i].isBlank()) {
        return parts[i].strip();
      }
    }
    return null;
  }
}
