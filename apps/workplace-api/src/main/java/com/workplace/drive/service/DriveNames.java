package com.workplace.drive.service;

import com.workplace.global.util.SafeFileNames;
import com.workplace.global.util.UnicodeNames;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 드라이브 파일·폴더 이름 규칙(WP-335·WP-339). 사용자가 짓는 이름의 검사와, ZIP 엔트리 경로로 쓸 때의 정리를 한곳에 둔다.
 *
 * <p>입력 검사({@link #valid})는 새로 들어오는 이름을 막고, ZIP 정리({@link #zipSegment}·{@link #uniqueIn})는 검사가 생기기
 * 전에 저장된 이름이나 업로드 경로로 들어온 이름까지 압축 파일 안에서 안전하게 만든다.
 */
final class DriveNames {
  private DriveNames() {}

  /** ZIP 에서 추가로 바꾸는 문자 — Windows 가 파일 이름에 허용하지 않아 압축 풀기에서 항목이 빠지거나 실패한다. */
  private static final Pattern WINDOWS_FORBIDDEN_CHARS = Pattern.compile("[:*?\"<>|]");

  /** Windows 예약 장치 이름(확장자와 무관하게 예약) — ZIP 에서 앞에 "_" 를 붙인다. */
  private static final Pattern WINDOWS_RESERVED =
      Pattern.compile("(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\\..*)?");

  /**
   * 이름 정규화·검사 — 앞뒤 공백(유니코드 공백 포함)을 지우고 NFC 로 맞춘 뒤, 빈 이름·"."·".."·금지 문자는 400. 폴더 ZIP 이 이름을 엔트리 경로로
   * 이어 붙여 구조가 깨지거나 경로를 벗어나지 않게 하고, 확장자를 뒤집어 보이게 하는 이름(예: "invoice‮fdp.exe")을 막는다.
   *
   * @param kind 오류 문구에 쓸 대상("파일"·"폴더")
   */
  static String valid(String raw, String kind) {
    String name = UnicodeNames.toNfc(raw.strip());
    if (SafeFileNames.isReserved(name)) {
      throw new IllegalArgumentException(kind + " 이름을 입력해주세요. \".\" 이나 \"..\" 만으로는 지을 수 없습니다.");
    }
    if (SafeFileNames.FORBIDDEN_CHARS.matcher(name).find()) {
      throw new IllegalArgumentException(kind + " 이름에 / \\ 나 제어 문자는 쓸 수 없습니다.");
    }
    return name;
  }

  /**
   * ZIP 경로 한 조각 — 경로·제어 문자와 Windows 금지 문자는 "_" 로, 끝의 점·공백은 지우고, 예약 장치 이름은 앞에 "_" 를 붙인다. 비거나
   * "."·".." 이면 "_". 압축을 풀 때 구조가 바뀌거나 대상 폴더 밖으로 나가거나 Windows 에서 항목이 빠지지 않게 한다.
   */
  static String zipSegment(String name) {
    String s = WINDOWS_FORBIDDEN_CHARS.matcher(SafeFileNames.sanitize(name, "_")).replaceAll("_");
    s = s.replaceAll("[. ]+$", "");
    if (s.isEmpty()) {
      return "_";
    }
    return WINDOWS_RESERVED.matcher(s).matches() ? "_" + s : s;
  }

  /**
   * 같은 ZIP 폴더 안에서 겹치지 않는 이름 — 이미 쓴 이름이면 "이름 (1).확장자" 처럼 번호를 붙이고 taken 에 기록한다. 파일과 폴더가 같은 이름이거나 여러
   * 폴더에서 같은 이름 파일을 골라 받을 때 항목이 빠지거나 ZIP 이 깨지지 않게 한다. 대소문자만 다른 이름도 macOS·Windows 에서 풀 때 겹치므로 같은 이름으로
   * 본다.
   *
   * @param isFile true 면 번호를 확장자 앞에 붙인다
   */
  static String uniqueIn(Set<String> taken, String name, boolean isFile) {
    int dot = isFile ? name.lastIndexOf('.') : -1;
    String stem = dot > 0 ? name.substring(0, dot) : name;
    String ext = dot > 0 ? name.substring(dot) : "";
    String candidate = name;
    for (int n = 1; !taken.add(candidate.toLowerCase(Locale.ROOT)); n++) {
      candidate = stem + " (" + n + ")" + ext;
    }
    return candidate;
  }
}
