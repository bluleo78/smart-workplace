package com.workplace.auth.sso;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** returnTo 오픈 리다이렉트 방지 — same-origin 상대경로만 통과. */
class ReturnToSanitizerTest {

  @ParameterizedTest
  @ValueSource(strings = {"/", "/projects/WP", "/settings/sso?tab=1", "/issues#c1"})
  void keepsSameOriginPaths(String path) {
    assertThat(ReturnToSanitizer.sanitize(path)).isEqualTo(path);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "https://evil.com", "//evil.com", "/\\evil.com", "\\\\evil.com", "%2F%2Fevil.com",
        "/%5Cevil.com", "/\t/evil.com", "javascript:alert(1)", "evil.com", ""
      })
  void rejectsUnsafeToRoot(String raw) {
    assertThat(ReturnToSanitizer.sanitize(raw)).isEqualTo("/");
  }

  @org.junit.jupiter.api.Test
  void nullBecomesRoot() {
    assertThat(ReturnToSanitizer.sanitize(null)).isEqualTo("/");
  }
}
