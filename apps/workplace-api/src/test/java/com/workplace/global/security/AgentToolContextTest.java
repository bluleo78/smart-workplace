package com.workplace.global.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** AgentToolContext 단위 테스트(WP-377) — 헤더 정규화와 자동 터치 억제 범위를 검증한다. */
class AgentToolContextTest {
  @AfterEach
  void clear() {
    AgentToolContext.clear();
  }

  @Test
  void normalize_허용문자만() {
    assertThat(AgentToolContext.normalize("Claude-Code")).isEqualTo("claude-code");
    assertThat(AgentToolContext.normalize("bad tool!")).isEqualTo("mcp");
    assertThat(AgentToolContext.normalize("x".repeat(41))).isEqualTo("mcp");
    assertThat(AgentToolContext.normalize("  ")).isNull();
    assertThat(AgentToolContext.normalize(null)).isNull();
  }

  @Test
  void suppressTouch_안에서만_억제되고_밖에선_복원() {
    assertThat(AgentToolContext.touchSuppressed()).isFalse();
    var r = AgentToolContext.suppressTouch(() -> AgentToolContext.touchSuppressed());
    assertThat(r).isTrue();
    assertThat(AgentToolContext.touchSuppressed()).isFalse();
  }
}
