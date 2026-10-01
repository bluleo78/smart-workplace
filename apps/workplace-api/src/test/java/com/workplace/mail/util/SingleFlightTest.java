package com.workplace.mail.util;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/** WP-149 같은 메일 동시 분석 방지 — 같은 키는 한 번만 실행하고 나머지는 끝날 때까지 기다린다. */
class SingleFlightTest {

  private final SingleFlight flight = new SingleFlight(Duration.ofSeconds(5));

  @Test
  void sameKey_runsOnce_otherWaits() throws Exception {
    AtomicInteger runs = new AtomicInteger();
    CountDownLatch started = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    CompletableFuture<Boolean> first =
        CompletableFuture.supplyAsync(
            () ->
                flight.run(
                    "content:1",
                    () -> {
                      runs.incrementAndGet();
                      started.countDown();
                      await(release);
                    }));
    assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
    CompletableFuture<Boolean> second =
        CompletableFuture.supplyAsync(() -> flight.run("content:1", runs::incrementAndGet));
    Thread.sleep(100); // 두 번째가 대기 상태에 들어갈 시간 — "실행되지 않음" 부재 확인이라 조건 대기로 대체할 수 없다
    assertThat(second).isNotDone();
    release.countDown();

    assertThat(first.get(2, TimeUnit.SECONDS)).isTrue();
    assertThat(second.get(2, TimeUnit.SECONDS)).isFalse();
    assertThat(runs).hasValue(1);
  }

  @Test
  void differentKeys_runIndependently() {
    AtomicInteger runs = new AtomicInteger();
    assertThat(flight.run("content:1", runs::incrementAndGet)).isTrue();
    assertThat(flight.run("content:2", runs::incrementAndGet)).isTrue();
    assertThat(runs).hasValue(2);
  }

  @Test
  void failure_propagates_andReleasesKey() {
    assertThatThrownBy(
            () ->
                flight.run(
                    "personal:9",
                    () -> {
                      throw new IllegalStateException("LLM 실패");
                    }))
        .isInstanceOf(IllegalStateException.class);
    AtomicInteger runs = new AtomicInteger();
    assertThat(flight.run("personal:9", runs::incrementAndGet)).isTrue();
    assertThat(runs).hasValue(1);
  }

  private static void await(CountDownLatch latch) {
    try {
      latch.await(5, TimeUnit.SECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }
}
