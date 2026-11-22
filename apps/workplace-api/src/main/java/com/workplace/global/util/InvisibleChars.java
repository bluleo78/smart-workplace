package com.workplace.global.util;

/**
 * 「보이지 않는 글자」 판정과 앞뒤 다듬기(WP-2011) — 이름·제목·텍스트의 앞뒤 다듬기에 쓰던 정규식 `^X+|X+$` 는 글자 사이에 긴 공백 줄이 있으면 시작
 * 위치마다 끝까지 훑어 길이의 제곱 시간이 걸렸다. 같은 범위를 코드 포인트로 양 끝에서만 훑어 입력 길이에 비례하게 한다.
 */
public final class InvisibleChars {
  private InvisibleChars() {}

  /**
   * 코드 포인트가 보이지 않는 글자인지 — 옛 {@code
   * PersonNames.INVISIBLE_CLASS}(`[\s\p{Z}\p{Cf}\u115F\u1160\u3164\uFFA0\u2800]`) 와 같은 범위: ASCII
   * \s(공백·탭·줄바꿈·VT·FF·CR), \p{Z}(Zs·Zl·Zp), \p{Cf}, 한글 채움 문자, 점자 빈칸.
   */
  public static boolean isInvisible(int codePoint) {
    switch (codePoint) {
      case ' ', '\t', '\n', 0x0B, '\f', '\r', 0x115F, 0x1160, 0x3164, 0xFFA0, 0x2800:
        return true;
      default:
        break;
    }
    int type = Character.getType(codePoint);
    return type == Character.SPACE_SEPARATOR
        || type == Character.LINE_SEPARATOR
        || type == Character.PARAGRAPH_SEPARATOR
        || type == Character.FORMAT;
  }

  /**
   * 앞뒤의 보이지 않는 글자를 뗀 부분 문자열 — 앞에서 codePointAt, 뒤에서 codePointBefore 로 한 번씩만 훑는다. 뗄 것이 없으면 s 그대로. s 는
   * null 이 아니어야 한다.
   */
  public static String stripEdges(String s) {
    int start = 0;
    int end = s.length();
    while (start < end) {
      int cp = s.codePointAt(start);
      if (!isInvisible(cp)) {
        break;
      }
      start += Character.charCount(cp);
    }
    while (end > start) {
      int cp = s.codePointBefore(end);
      if (!isInvisible(cp)) {
        break;
      }
      end -= Character.charCount(cp);
    }
    // 옛 정규식의 `X+$` 는 `$` 가 문자열 끝의 줄 끝 문자(U+0085) 앞에서도 맞아, 문자열 맨 끝(뒤에서 뗀 것이 없을 때)의 U+0085 바로 앞 보이지
    // 않는 줄도 지웠다.
    // \n·\r·U+2028·U+2029 는 이미 보이지 않는 글자라 위 훑기가 처리하므로 U+0085 만 같은 결과가 되게 따로 맞춘다.
    if (end == s.length() && end > start && s.charAt(end - 1) == '\u0085') {
      int runEnd = end - 1;
      int runStart = runEnd;
      while (runStart > start) {
        int cp = s.codePointBefore(runStart);
        if (!isInvisible(cp)) {
          break;
        }
        runStart -= Character.charCount(cp);
      }
      if (runStart < runEnd) {
        return s.substring(start, runStart) + '\u0085';
      }
    }
    return (start == 0 && end == s.length()) ? s : s.substring(start, end);
  }
}
