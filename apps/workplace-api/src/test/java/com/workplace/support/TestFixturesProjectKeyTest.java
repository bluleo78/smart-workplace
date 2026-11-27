package com.workplace.support;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** TestFixtures.uniqueProjectKey 의 순수 단위 테스트(WP-2162) — Spring 컨텍스트 없이 돈다. */
class TestFixturesProjectKeyTest {

  /** 기본 길이 10 까지 접두 뒤를 무작위로 채우고, 프로젝트 키 형식을 지킨다. */
  @Test
  void uniqueProjectKey_fillsToTenWithPrefix() {
    String key = TestFixtures.uniqueProjectKey("ID");

    assertThat(key).hasSize(10).startsWith("ID").matches("^[A-Z][A-Z0-9]{1,9}$");
  }

  /** 길이를 직접 정할 수 있다. */
  @Test
  void uniqueProjectKey_customLength() {
    assertThat(TestFixtures.uniqueProjectKey("AB", 9)).hasSize(9).matches("^[A-Z0-9]+$");
  }

  /** 무작위 자리가 정확히 6자 남는 가장 긴 접두(4자)도 통과한다. */
  @Test
  void uniqueProjectKey_acceptsPrefixLeavingMinimumRandom() {
    assertThat(TestFixtures.uniqueProjectKey("ABCD"))
        .hasSize(10)
        .startsWith("ABCD")
        .matches("^[A-Z][A-Z0-9]{1,9}$");
  }

  /**
   * 천 번을 만들어도 겹치지 않는다 — 36^8 가지라 겹칠 확률은 약 n²/2N ≈ 1.8e-7, 곧 약 560만분의 1(만 번이면 약 1.8e-5, 5만6천분의 1로 이
   * 테스트가 깜빡인다).
   */
  @Test
  void uniqueProjectKey_rarelyRepeats() {
    Set<String> keys = new HashSet<>();
    for (int i = 0; i < 1_000; i++) {
      keys.add(TestFixtures.uniqueProjectKey("ID"));
    }

    assertThat(keys).hasSize(1_000);
  }

  /** 형식에 어긋나거나 무작위 자리가 모자라는 접두·길이는 거절한다. */
  @Test
  void uniqueProjectKey_rejectsBadPrefix() {
    assertThatThrownBy(() -> TestFixtures.uniqueProjectKey("id"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> TestFixtures.uniqueProjectKey(""))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> TestFixtures.uniqueProjectKey("1A"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> TestFixtures.uniqueProjectKey("ABCDE"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> TestFixtures.uniqueProjectKey("AB", 11))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
