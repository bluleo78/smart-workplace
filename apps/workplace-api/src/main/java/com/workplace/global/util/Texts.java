package com.workplace.global.util;

/** 표시용 문자열 가공 유틸. 알림 제목·미리보기처럼 길이 제한이 있는 곳에서 공용으로 쓴다. */
public final class Texts {

  private Texts() {}

  /**
   * 코드포인트 기준 max 자로 자르고 말줄임표(…)를 붙인다. char 단위로 자르면 이모지 등 서로게이트 쌍이 반쪽으로 잘려 깨진 문자가 되므로 코드포인트로 센다.
   * null 은 빈 문자열.
   */
  public static String truncateCodePoints(String s, int max) {
    if (s == null) return "";
    if (s.codePointCount(0, s.length()) <= max) return s;
    return s.substring(0, s.offsetByCodePoints(0, max)) + "…";
  }
}
