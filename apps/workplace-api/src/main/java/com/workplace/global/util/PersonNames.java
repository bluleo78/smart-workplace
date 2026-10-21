package com.workplace.global.util;

import java.util.regex.Pattern;

/**
 * 사람 이름(구성원 표시 이름) 정규화·검사(WP-572) — 이름은 목록·멘션·담당자 표시에 그대로 쓰이므로, 앞뒤 공백이나 보이지 않는 문자만 남은 이름, 줄을 바꾸거나
 * 표시 순서를 뒤집는 이름이 저장되지 않게 한곳에서 막는다.
 */
public final class PersonNames {
  private PersonNames() {}

  /**
   * 보이지 않는 문자 — 공백류(유니코드 공백·전각 공백 포함), 서식 문자(제로폭 공백·결합자·BOM 등 \p{Cf}), 한글 채움 문자, 점자 빈칸(U+2800,
   * WP-724).
   */
  static final String INVISIBLE_CLASS = "[\\s\\p{Z}\\p{Cf}\\u115F\\u1160\\u3164\\uFFA0\\u2800]";

  /**
   * 그려지는 글자 하나(WP-724) — 위 보이지 않는 문자와 제어 문자, 그리고 홀로는 그려지지 않는 결합 문자(\p{Mn}·\p{Me}: 결합 문자 CGJ
   * U+034F·변형 선택자 U+FE00–FE0F 등)가 아닌 글자. 결합 문자는 앞 글자에 붙어 뜻을 가지므로 앞뒤에서 지우지는 않고(「क्」 같은 이름이 바뀐다)
   * 이것만으로 된 이름을 막는 데만 쓴다.
   */
  private static final Pattern VISIBLE =
      Pattern.compile(
          "[^\\s\\p{Z}\\p{Cf}\\p{Cc}\\p{Mn}\\p{Me}\\u115F\\u1160\\u3164\\uFFA0\\u2800]");

  private static final Pattern INVISIBLE_EDGES =
      Pattern.compile("^" + INVISIBLE_CLASS + "+|" + INVISIBLE_CLASS + "+$");

  /** 금지 문자 — 제어 문자(C0·C1: 줄바꿈·탭 등), 줄/문단 구분자, 양방향 제어 문자(SafeFileNames 와 같은 범위에서 경로 구분자만 뺐다). */
  private static final Pattern FORBIDDEN =
      Pattern.compile("[\\p{Cc}\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069]");

  /**
   * NFC 로 맞추고 앞뒤의 보이지 않는 문자를 지운 이름을 돌려준다. 남은 것이 없으면(null·공백·제로폭 문자뿐) 「이름을 입력해 주세요」, 제어 문자·양방향 제어
   * 문자가 있으면 IllegalArgumentException(400).
   */
  public static String normalize(String raw) {
    String name =
        raw == null ? "" : INVISIBLE_EDGES.matcher(UnicodeNames.toNfc(raw)).replaceAll("");
    if (!hasVisibleChar(name)) {
      throw new IllegalArgumentException("이름을 입력해 주세요");
    }
    if (FORBIDDEN.matcher(name).find()) {
      throw new IllegalArgumentException("이름에 줄바꿈·탭 같은 제어 문자는 쓸 수 없습니다");
    }
    return name;
  }

  /** 화면에 그려지는 글자가 하나라도 있는지(WP-724) — 이름·제목·메모 내용이 빈 칸으로 보이지 않게 저장 전에 거른다. null 은 false. */
  public static boolean hasVisibleChar(String s) {
    return s != null && VISIBLE.matcher(s).find();
  }
}
