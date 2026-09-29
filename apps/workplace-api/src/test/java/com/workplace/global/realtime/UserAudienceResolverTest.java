package com.workplace.global.realtime;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** USER scope 리졸버 단위 테스트 — scopeId 가 곧 유일한 수신자인지 확인한다. */
class UserAudienceResolverTest {
  @Test
  void resolvesScopeIdAsSingleRecipient() {
    var r = new UserAudienceResolver();
    assertThat(r.scopeType()).isEqualTo("USER");
    assertThat(r.resolve(42L)).containsExactly(42L);
  }
}
