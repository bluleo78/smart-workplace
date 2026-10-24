package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** KoreanParticles.direction — 방향 조사 「로/으로」. 웹 lib/utils.ts directionParticle 과 같은 규칙(WP-869). */
class KoreanParticlesTest {

  @Test
  void 받침없음과_ㄹ받침은_로() {
    assertThat(KoreanParticles.direction("완료")).isEqualTo("로");
    assertThat(KoreanParticles.direction("할 일")).isEqualTo("로");
  }

  @Test
  void 그밖의_받침은_으로() {
    assertThat(KoreanParticles.direction("진행 중")).isEqualTo("으로");
    assertThat(KoreanParticles.direction("검토 대기 중")).isEqualTo("으로");
  }

  @Test
  void 한글로_끝나지_않으면_폴백() {
    assertThat(KoreanParticles.direction("QA")).isEqualTo("(으)로");
    assertThat(KoreanParticles.direction("v2")).isEqualTo("(으)로");
    assertThat(KoreanParticles.direction("")).isEqualTo("(으)로");
  }
}
