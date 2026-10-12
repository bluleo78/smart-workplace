package com.workplace.global.util;

import java.util.regex.Pattern;

/**
 * 파일·폴더 이름 안전 규칙(WP-335·WP-339) — 이름이 경로처럼 해석되거나(경로 구분자·"."·".."), 줄을 바꾸거나(제어 문자·줄 구분자), 확장자를 뒤집어
 * 보이게 하는(양방향 제어 문자, 예: "invoice‮fdp.exe") 문자를 한곳에서 정의한다.
 *
 * <p>사용자가 직접 짓는 이름(이름 변경·폴더 만들기)은 이 문자가 있으면 거절하고, 사용자가 고칠 수 없는 이름(업로드 원본 파일명·폴더 업로드 경로)은 {@link
 * #sanitize} 로 바꿔 받는다 — 업로드 자체가 실패하거나 다른 파일과 이름이 합쳐지지 않게.
 */
public final class SafeFileNames {
  private SafeFileNames() {}

  /** 금지 문자 — 경로 구분자, 제어 문자(C0·C1), 줄/문단 구분자, 양방향 제어 문자. */
  public static final Pattern FORBIDDEN_CHARS =
      Pattern.compile("[/\\\\\\p{Cc}\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069]");

  /** 이름으로 쓸 수 없는 값 — 비었거나 "."·".." 자체. */
  public static boolean isReserved(String name) {
    return name.isEmpty() || name.equals(".") || name.equals("..");
  }

  /** 금지 문자를 "_" 로 바꾸고 앞뒤 공백을 지운다. 남은 값이 비거나 "."·".." 이면 fallback. */
  public static String sanitize(String name, String fallback) {
    String s = FORBIDDEN_CHARS.matcher(name).replaceAll("_").strip();
    return isReserved(s) ? fallback : s;
  }
}
