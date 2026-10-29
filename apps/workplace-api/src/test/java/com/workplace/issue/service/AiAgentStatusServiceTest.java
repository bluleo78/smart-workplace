package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

/** AI별 보기(WP-1201) 연결 판정 — 마지막으로 연결돼 있던 시각이 유예(3분) 안이면 연결, 넘거나 모르면 끊김. */
class AiAgentStatusServiceTest {

  private static final Instant NOW = Instant.parse("2026-10-29T05:00:00Z");

  /** 지금 연결 중(마지막 확인 = 지금)이면 연결. */
  @Test
  void isConnected_whenSeenNow_returnsTrue() {
    assertThat(AiAgentStatusService.isConnected(NOW, NOW)).isTrue();
  }

  /** 끊긴 지 유예 안(2분)이면 아직 연결로 본다. */
  @Test
  void isConnected_whenDisconnectedWithinGrace_returnsTrue() {
    assertThat(AiAgentStatusService.isConnected(NOW.minusSeconds(120), NOW)).isTrue();
  }

  /** 유예(3분)를 넘기면 끊김. */
  @Test
  void isConnected_whenDisconnectedPastGrace_returnsFalse() {
    assertThat(AiAgentStatusService.isConnected(NOW.minusSeconds(180), NOW)).isFalse();
  }

  /** 끊긴 시각을 모르면(서버 재시작 뒤 아직 안 붙음) 끊김. */
  @Test
  void isConnected_whenNeverSeen_returnsFalse() {
    assertThat(AiAgentStatusService.isConnected(null, NOW)).isFalse();
  }
}
