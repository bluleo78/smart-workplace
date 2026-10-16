package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.home.repository.AiMemoryRepository.Row;
import java.time.Instant;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/** WP-385 "그대로" 술어 — 내용·종류·범위·기한이 같으면 그대로(고정·사용 시각·수정 시각은 보지 않는다). */
class MemorySnapshotTest {

  private static final Instant T = Instant.parse("2026-10-15T00:00:00Z");

  private static Row row(String content, String kind, String scope, LocalDate exp, boolean pinned) {
    return new Row(7, kind, content, "AI", null, T, T, scope, exp, pinned, T);
  }

  @Test
  void 내용_종류_범위_기한이_같으면_그대로다() {
    MemorySnapshot s =
        MemorySnapshot.of(row("표로 정리한다", "PREFERENCE", "ISSUE", LocalDate.of(2026, 10, 31), false));
    assertThat(s.sameAs(row("표로 정리한다", "PREFERENCE", "ISSUE", LocalDate.of(2026, 10, 31), true)))
        .isTrue();
  }

  @Test
  void 하나라도_다르거나_없으면_그대로가_아니다() {
    MemorySnapshot s = MemorySnapshot.of(row("표로 정리한다", "PREFERENCE", null, null, false));
    assertThat(s.sameAs(row("표로 정리한다!", "PREFERENCE", null, null, false))).isFalse();
    assertThat(s.sameAs(row("표로 정리한다", "CONTEXT", null, null, false))).isFalse();
    assertThat(s.sameAs(row("표로 정리한다", "PREFERENCE", "MAIL", null, false))).isFalse();
    assertThat(s.sameAs(row("표로 정리한다", "PREFERENCE", null, LocalDate.of(2026, 11, 1), false)))
        .isFalse();
    assertThat(s.sameAs(null)).isFalse();
  }

  @Test
  void 새_메모리로_되살릴_때_같은_값을_쓴다() {
    MemorySnapshot s =
        MemorySnapshot.of(row("표로", "CONTEXT", "WIKI", LocalDate.of(2026, 12, 1), false));
    var m = s.toNewMemory();
    assertThat(m.content()).isEqualTo("표로");
    assertThat(m.kind()).isEqualTo("CONTEXT");
    assertThat(m.scope()).isEqualTo("WIKI");
    assertThat(m.expiresOn()).isEqualTo(LocalDate.of(2026, 12, 1));
    assertThat(m.source()).isEqualTo("AI");
  }
}
