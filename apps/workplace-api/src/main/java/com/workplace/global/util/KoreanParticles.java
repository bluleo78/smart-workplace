package com.workplace.global.util;

/**
 * 한국어 조사 고르기 — 이름 뒤에 붙는 조사를 마지막 음절 받침에 맞춘다. 서버가 만드는 문구(푸시 등)가 웹 인박스(lib/utils.ts
 * directionParticle)와 같은 말로 보이게 같은 규칙을 둔다.
 */
public final class KoreanParticles {
  private KoreanParticles() {}

  private static final char HANGUL_FIRST = '가';
  private static final char HANGUL_LAST = '힣';
  // 종성 인덱스 — 0: 받침 없음, 8: ㄹ 받침.
  private static final int JONG_COUNT = 28;
  private static final int JONG_RIEUL = 8;

  /**
   * 방향 조사 「로/으로」(「'완료'로」·「'진행 중'으로」). 받침 없음·ㄹ 받침은 「로」, 그 밖의 받침은 「으로」. 한글 음절로 끝나지 않는 이름(영문·숫자 등)은 읽는
   * 법을 알 수 없어 「(으)로」로 둔다.
   */
  public static String direction(String name) {
    if (name == null || name.isEmpty()) return "(으)로";
    char last = name.charAt(name.length() - 1);
    if (last < HANGUL_FIRST || last > HANGUL_LAST) return "(으)로";
    int jong = (last - HANGUL_FIRST) % JONG_COUNT;
    return jong == 0 || jong == JONG_RIEUL ? "로" : "으로";
  }
}
