package com.workplace.auth.sso;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/**
 * 로그인 뒤 돌아갈 경로 정제 — same-origin 상대경로만 통과시켜 오픈 리다이렉트를 막는다(WP-48).
 *
 * <p>인코딩된 변형(%2F%2F, %5C)은 한 번 디코드한 값으로도 검사한다. 제어 문자는 통째로 거부한다 — 브라우저가 URL 의 탭·개행을 지우고 해석해
 * "/\t/evil.com" 이 "//evil.com" 이 되기 때문이다. (iacloud_eis 구현 이식)
 */
final class ReturnToSanitizer {

  private static final String ROOT = "/";

  private ReturnToSanitizer() {}

  static String sanitize(String raw) {
    if (raw == null || raw.isEmpty()) return ROOT;
    String decoded;
    try {
      decoded = URLDecoder.decode(raw, StandardCharsets.UTF_8);
    } catch (IllegalArgumentException e) {
      return ROOT;
    }
    if (!isSafe(raw) || !isSafe(decoded)) return ROOT;
    return raw;
  }

  private static boolean isSafe(String path) {
    if (!path.startsWith("/") || path.startsWith("//") || path.contains("\\")) return false;
    return path.chars().noneMatch(c -> c < 0x20 || c == 0x7f);
  }
}
