package com.workplace.global.util;

import java.util.regex.Pattern;

/**
 * 파일·폴더 이름 안전 규칙(WP-335·WP-339) — 이름이 경로처럼 해석되거나(경로 구분자·"."·".."), 줄을 바꾸거나(제어 문자·줄 구분자), 확장자를 뒤집어
 * 보이게 하는(양방향 제어 문자, 예: "invoice‮fdp.exe") 문자를 한곳에서 정의한다.
 *
 * <p>사용자가 직접 짓는 이름(이름 변경·폴더 만들기)은 {@link #validate} 로 거절하고, 사용자가 고칠 수 없는 이름(업로드 원본 파일명·폴더 업로드 경로)은
 * {@link #sanitize} 로 바꿔 받는다 — 업로드 자체가 실패하거나 다른 파일과 이름이 합쳐지지 않게. 둘 다 NFC 로 정규화한다(UnicodeNames).
 */
public final class SafeFileNames {
  private SafeFileNames() {}

  /** 금지 문자 문자 클래스 본문 — 경로 구분자, 제어 문자(C0·C1), 줄/문단 구분자, 양방향 제어 문자. ZIP 처럼 문자를 더 막는 곳이 이어 붙여 쓴다. */
  public static final String FORBIDDEN_CLASS =
      "/\\\\\\p{Cc}\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069";

  private static final Pattern FORBIDDEN_CHARS = Pattern.compile("[" + FORBIDDEN_CLASS + "]");

  /** 이름 저장 칸 길이(문자 수) — file.original_name·drive_file.name·폴더 이름이 모두 varchar(255)(WP-561). */
  public static final int MAX_LENGTH = 255;

  /** 줄일 때 살리는 확장자 최대 길이(점 포함) — 이보다 긴 꼬리는 확장자가 아니라 이름의 일부로 본다. */
  private static final int MAX_EXTENSION_LENGTH = 16;

  /**
   * 사용자가 지은 이름 정규화·검사 — 앞뒤 공백(유니코드 공백 포함)을 지우고 NFC 로 맞춘 뒤, 빈 이름·"."·".."·금지 문자는
   * IllegalArgumentException(400).
   *
   * @param kind 오류 문구에 쓸 대상("파일"·"폴더")
   */
  public static String validate(String raw, String kind) {
    String name = UnicodeNames.toNfc(raw.strip());
    if (isReserved(name)) {
      throw new IllegalArgumentException(kind + " 이름을 입력해주세요. \".\" 이나 \"..\" 만으로는 지을 수 없습니다.");
    }
    if (FORBIDDEN_CHARS.matcher(name).find()) {
      throw new IllegalArgumentException(kind + " 이름에 / \\ 나 제어 문자는 쓸 수 없습니다.");
    }
    if (name.codePointCount(0, name.length()) > MAX_LENGTH) {
      throw new IllegalArgumentException(kind + " 이름은 " + MAX_LENGTH + "자까지 쓸 수 있습니다.");
    }
    return name;
  }

  /**
   * 고칠 수 없는 이름 정리 — NFC 로 맞추고 금지 문자를 "_" 로 바꾼 뒤 앞뒤 공백을 지우고 저장 칸 길이에 맞춘다({@link #fitLength}). null·빈
   * 값·"."·".."·보이지 않는 글자(제로폭·점자 빈칸 등)뿐이면 fallback — 이름이 빈 칸인 파일이 생기지 않게(WP-781).
   */
  public static String sanitize(String raw, String fallback) {
    if (raw == null) {
      return fallback;
    }
    String s = FORBIDDEN_CHARS.matcher(UnicodeNames.toNfc(raw)).replaceAll("_").strip();
    return isReserved(s) || !PersonNames.hasVisibleChar(s) ? fallback : fitLength(s);
  }

  /**
   * 업로드 원본 파일명을 저장 칸({@link #MAX_LENGTH}자)에 맞춘다(WP-561) — 넘으면 확장자를 살리고 앞 이름을 줄인다. 이전에는 그대로 넣다가 DB 가
   * 거절해 409 「Data integrity violation」이 났다. 문자 수는 코드포인트로 세어 서로게이트 쌍(이모지)을 가르지 않는다. null 은 그대로.
   */
  public static String fitLength(String name) {
    if (name == null || name.codePointCount(0, name.length()) <= MAX_LENGTH) {
      return name;
    }
    int dot = name.lastIndexOf('.');
    String ext =
        dot > 0 && name.codePointCount(dot, name.length()) <= MAX_EXTENSION_LENGTH
            ? name.substring(dot)
            : "";
    String base = ext.isEmpty() ? name : name.substring(0, dot);
    int keep = MAX_LENGTH - ext.codePointCount(0, ext.length());
    return base.substring(0, base.offsetByCodePoints(0, keep)) + ext;
  }

  private static boolean isReserved(String name) {
    return name.isEmpty() || name.equals(".") || name.equals("..");
  }
}
