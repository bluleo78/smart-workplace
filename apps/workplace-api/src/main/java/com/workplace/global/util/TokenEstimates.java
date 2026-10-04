package com.workplace.global.util;

/**
 * 토큰 수 근사(WP-232). 코드베이스에 토크나이저가 없고 러너(Claude SDK·opencode)별 토크나이저도 달라, 예산을 넘기지 않도록 보수적으로 센다 —
 * ASCII 는 4자당 1토큰(올림), 그 외(한글 등)는 1자당 1토큰.
 */
public final class TokenEstimates {

  /** 잘린 본문 끝에 붙이는 표식. */
  public static final String TRUNCATION_MARK = "…(이하 생략)";

  private TokenEstimates() {}

  /** 문자열의 근사 토큰 수. null/빈 문자열은 0. */
  public static int estimate(String s) {
    if (s == null || s.isEmpty()) return 0;
    int ascii = 0;
    int other = 0;
    for (int i = 0; i < s.length(); ) {
      int cp = s.codePointAt(i);
      if (cp < 0x80) ascii++;
      else other++;
      i += Character.charCount(cp);
    }
    return other + (ascii + 3) / 4;
  }

  /**
   * 근사 토큰이 maxTokens 를 넘으면 앞부분을 남기고 {@link #TRUNCATION_MARK} 를 붙인다(결과도 maxTokens 이내). 이내면 원문, null
   * 은 null.
   */
  public static String truncate(String s, int maxTokens) {
    if (s == null || estimate(s) <= maxTokens) return s;
    int budget = Math.max(0, maxTokens - estimate(TRUNCATION_MARK));
    int ascii = 0;
    int other = 0;
    int end = 0;
    for (int i = 0; i < s.length(); ) {
      int cp = s.codePointAt(i);
      int nextAscii = ascii + (cp < 0x80 ? 1 : 0);
      int nextOther = other + (cp < 0x80 ? 0 : 1);
      if (nextOther + (nextAscii + 3) / 4 > budget) break;
      ascii = nextAscii;
      other = nextOther;
      i += Character.charCount(cp);
      end = i;
    }
    return s.substring(0, end) + TRUNCATION_MARK;
  }
}
