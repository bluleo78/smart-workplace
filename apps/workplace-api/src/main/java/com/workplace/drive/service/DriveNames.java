package com.workplace.drive.service;

import com.workplace.global.util.SafeFileNames;
import com.workplace.global.util.UnicodeNames;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 드라이브 이름을 ZIP 엔트리 경로로 쓸 때의 정리(WP-339). 입력 검사({@link SafeFileNames})가 생기기 전에 저장된 이름이나 다른 경로로 들어온
 * 이름까지 압축 파일 안에서 안전하게 만든다 — 경로를 벗어나거나, 구조가 바뀌거나, 같은 이름이 겹쳐 항목이 빠지거나, Windows 에서 풀리지 않는 일이 없게.
 */
final class DriveNames {
  private DriveNames() {}

  /** ZIP 금지 문자 — 공용 금지 문자 + Windows 가 파일 이름에 허용하지 않는 문자(압축 풀기에서 항목이 빠지거나 실패). */
  private static final Pattern ZIP_FORBIDDEN_CHARS =
      Pattern.compile("[" + SafeFileNames.FORBIDDEN_CLASS + ":*?\"<>|]");

  /** Windows 예약 장치 이름(확장자와 무관하게 예약) — ZIP 에서 앞에 "_" 를 붙인다. */
  private static final Pattern WINDOWS_RESERVED =
      Pattern.compile("(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\\..*)?");

  /**
   * 같은 ZIP 폴더 안에서 쓸 엔트리 이름 — {@link #zipSegment} 로 정리한 뒤 이미 쓴 이름이면 "이름 (1).확장자" 처럼 번호를 붙이고 taken 에
   * 기록한다. 파일과 폴더가 같은 이름이거나 여러 폴더에서 같은 이름 파일을 골라 받을 때 항목이 빠지거나 ZIP 이 깨지지 않게 한다. 대소문자만 다른 이름도
   * macOS·Windows 에서 풀 때 겹치므로 같은 이름으로 본다.
   *
   * @param isFile true 면 번호를 확장자 앞에 붙인다
   */
  static String zipName(Set<String> taken, String rawName, boolean isFile) {
    String name = zipSegment(rawName);
    int dot = isFile ? name.lastIndexOf('.') : -1;
    String stem = dot > 0 ? name.substring(0, dot) : name;
    String ext = dot > 0 ? name.substring(dot) : "";
    String candidate = name;
    for (int n = 1; !taken.add(candidate.toLowerCase(Locale.ROOT)); n++) {
      candidate = stem + " (" + n + ")" + ext;
    }
    return candidate;
  }

  /**
   * ZIP 경로 한 조각 — 금지 문자는 "_" 로, 앞 공백과 끝의 점·공백은 지우고, 예약 장치 이름은 앞에 "_" 를 붙인다. 남는 게 없으면("."·".." 포함)
   * "_".
   */
  private static String zipSegment(String raw) {
    String s = ZIP_FORBIDDEN_CHARS.matcher(UnicodeNames.toNfc(raw)).replaceAll("_").strip();
    int end = s.length();
    while (end > 0 && (s.charAt(end - 1) == '.' || s.charAt(end - 1) == ' ')) {
      end--;
    }
    s = s.substring(0, end);
    if (s.isEmpty()) {
      return "_";
    }
    return WINDOWS_RESERVED.matcher(s).matches() ? "_" + s : s;
  }
}
