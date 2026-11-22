package com.workplace.airun.status;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

/** AI 현황 기간 코드 해석과 구간 크기 검증. */
class AiStatusPeriodTest {

  @Test
  void parse_nullIsDefault24h() {
    assertThat(AiStatusPeriod.parse(null)).isEqualTo(AiStatusPeriod.H24);
  }

  @Test
  void bucketAndLength() {
    assertThat(AiStatusPeriod.parse("1h").bucket()).isEqualTo(Duration.ofMinutes(5));
    assertThat(AiStatusPeriod.parse("24h").bucket()).isEqualTo(Duration.ofHours(1));
    assertThat(AiStatusPeriod.parse("7d").bucket()).isEqualTo(Duration.ofHours(6));
    assertThat(AiStatusPeriod.parse("30d").bucket()).isEqualTo(Duration.ofDays(1));
    assertThat(AiStatusPeriod.parse("30d").length()).isEqualTo(Duration.ofDays(30));
    assertThat(AiStatusPeriod.parse("7d").code()).isEqualTo("7d");
  }

  @Test
  void parse_unknownThrows() {
    assertThatThrownBy(() -> AiStatusPeriod.parse("2h"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("기간은 1h·24h·7d·30d 중 하나여야 합니다");
  }
}
