package com.workplace.global.util;

/** 문자열 가공 유틸. 알림 제목·미리보기, AI 요청 본문처럼 길이 제한이 있는 곳에서 공용으로 쓴다. */
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

  /**
   * 앞 max 글자(UTF-16 단위)만 남긴다 — 말줄임표 없음, null 은 그대로. 경계가 서로게이트 쌍(이모지 등) 한가운데면 한 글자 덜 잘라, 짝 잃은 high
   * surrogate 가 JSON 직렬화·전송에서 깨진 문자가 되지 않게 한다. AI 요청 본문 크기를 묶는 곳(위키 요약 입력·후속 질문 질문/답)이 같은 규칙을 쓰도록 한
   * 곳에 둔다. max 가 0 이하면 빈 문자열.
   */
  public static String headUtf16(String s, int max) {
    if (s == null || s.length() <= max) return s;
    if (max <= 0) return "";
    int end = Character.isHighSurrogate(s.charAt(max - 1)) ? max - 1 : max;
    return s.substring(0, end);
  }

  /** 빈 문자열·공백뿐인 문자열은 null 로, 그 밖은 그대로 — 선택 값이 비어 오면 "없음"으로 통일해 저장·비교하려고 쓴다. */
  public static String blankToNull(String s) {
    return s == null || s.isBlank() ? null : s;
  }

  /**
   * 앞뒤 공백을 떼고 대소문자를 무시해 같은 이름인가 — Outlook 범주 이름·메일 주소처럼 표기가 조금 달라도 같은 것으로 보는 비교. 어느 쪽이든 null 이면 같지
   * 않다.
   */
  public static boolean equalsStrippedIgnoreCase(String a, String b) {
    return a != null && b != null && a.strip().equalsIgnoreCase(b.strip());
  }
}
