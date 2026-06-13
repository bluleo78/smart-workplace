package com.workplace.global.tenant;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** TenantContext ThreadLocal set/get/clear 라운드트립 순수 단위 테스트. */
class TenantContextTest {

  @AfterEach
  void cleanup() {
    // 다른 테스트로 ThreadLocal 누수를 막기 위해 항상 정리한다.
    TenantContext.clear();
  }

  @Test
  void setThenGet_returnsTenantId() {
    TenantContext.set(7L);
    assertThat(TenantContext.get()).isEqualTo(7L);
  }

  @Test
  void get_isNull_afterClear() {
    TenantContext.set(7L);
    TenantContext.clear();
    assertThat(TenantContext.get()).isNull();
  }

  @Test
  void get_isNull_whenNeverSet() {
    assertThat(TenantContext.get()).isNull();
  }
}
