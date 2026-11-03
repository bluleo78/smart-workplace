package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** WP-1322 — 옛 생각의 깊이 값을 저장할 새 값으로 옮기는 규칙(V263 마이그레이션과 같음). */
class ThinkingDepthsTest {

  @Test
  void Claude_연결은_NONE_NORMAL_DEEP_을_LOW_HIGH_MAX_로() {
    assertThat(ThinkingDepths.toStored("NONE", true)).isEqualTo("LOW");
    assertThat(ThinkingDepths.toStored("NORMAL", true)).isEqualTo("HIGH");
    assertThat(ThinkingDepths.toStored("DEEP", true)).isEqualTo("MAX");
  }

  @Test
  void 그_외_연결은_옛_값을_DEFAULT_로() {
    assertThat(ThinkingDepths.toStored("NORMAL", false)).isEqualTo("DEFAULT");
    assertThat(ThinkingDepths.toStored("DEEP", false)).isEqualTo("DEFAULT");
  }

  @Test
  void 새_값과_null_은_그대로() {
    assertThat(ThinkingDepths.toStored("XHIGH", true)).isEqualTo("XHIGH");
    assertThat(ThinkingDepths.toStored("LOW", false)).isEqualTo("LOW");
    assertThat(ThinkingDepths.toStored(null, true)).isNull();
  }

  @Test
  void 검증_정규식은_새_값과_옛_값의_합집합과_같다() {
    Set<String> union = new HashSet<>(ThinkingDepths.ALLOWED);
    union.addAll(ThinkingDepths.LEGACY);
    assertThat(Set.of(ThinkingDepths.PATTERN.split("\\|"))).isEqualTo(union);
    assertThat(ThinkingDepths.isLegacy("NORMAL")).isTrue();
    assertThat(ThinkingDepths.isLegacy("HIGH")).isFalse();
    assertThat(ThinkingDepths.isLegacy(null)).isFalse();
  }
}
