package com.workplace.airun;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/** RoundDeadline 단위 테스트(WP-2111) — 잠금 최대가 여유 이하인 설정 실수를 생성 시 바로 드러내는지, 마감 판정이 경계에서 맞는지. */
class RoundDeadlineTest {

  private final Clock fixed = Clock.fixed(Instant.parse("2026-11-25T00:00:00Z"), ZoneOffset.UTC);

  @Test
  void 잠금_최대가_여유와_같거나_짧으면_생성_시_거절한다() {
    assertThatThrownBy(() -> RoundDeadline.underLock(fixed, RoundDeadline.LOCK_MARGIN))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> RoundDeadline.underLock(fixed, Duration.ofMinutes(1)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> RoundDeadline.underLock(fixed, Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void 잠금_최대가_여유보다_길면_그_차이가_예산이다() {
    RoundDeadline d =
        RoundDeadline.underLock(fixed, RoundDeadline.LOCK_MARGIN.plus(Duration.ofSeconds(1)));
    assertThat(d.remaining()).isEqualTo(Duration.ofSeconds(1));
    assertThat(d.allows(Duration.ofSeconds(1))).isTrue();
    assertThat(d.allows(Duration.ofSeconds(2))).isFalse();
  }

  @Test
  void 무제한은_무엇이든_허용한다() {
    RoundDeadline d = RoundDeadline.unlimited();
    assertThat(d.remaining()).isNull();
    assertThat(d.allows(Duration.ofDays(365))).isTrue();
  }
}
