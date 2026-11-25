package com.workplace.support;

import static com.workplace.support.ResourceChangedCapture.capture;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import com.workplace.global.realtime.SseRegistry;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * ResourceChangedCapture 단위 테스트 (WP-2117). 공유 mock 레지스트리에 다른 테스트의 이벤트가 먼저·늦게 섞여도 맞는 이벤트를 기다리는지
 * Spring 없이 검증한다.
 */
class ResourceChangedCaptureTest {

  @Test
  void waitsForMatchingEventEvenIfOtherEventArrivesFirst() throws Exception {
    SseRegistry registry = mock(SseRegistry.class);
    registry.fanOut(List.of(9L), "resource.changed", Map.of("resource", "other", "op", "updated"));
    Thread t =
        new Thread(
            () -> {
              try {
                Thread.sleep(300);
              } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
              }
              registry.fanOut(
                  List.of(1L), "resource.changed", Map.of("resource", "issue", "op", "created"));
            });
    t.start();
    try {
      var captured = capture(registry, "issue", "created");
      assertThat(captured.recipients()).containsExactly(1L);
      assertThat(captured.payload()).containsEntry("resource", "issue");
    } finally {
      t.join();
    }
  }

  @Test
  void failsWithMissingMessageWhenNoMatchingEvent() {
    SseRegistry registry = mock(SseRegistry.class);
    registry.fanOut(List.of(9L), "resource.changed", Map.of("resource", "other", "op", "updated"));
    assertThatThrownBy(
            () ->
                capture(
                    registry,
                    p -> "issue".equals(p.get("resource")) && "deleted".equals(p.get("op")),
                    "issue/deleted",
                    100))
        .isInstanceOf(AssertionError.class)
        .hasMessageContaining("resource.changed issue/deleted 미수신");
  }

  @Test
  void attachesSwallowedPredicateExceptionToMissingError() {
    // 조건이 예외를 내면 「맞지 않음」으로 보되, 미수신 오류에 그 예외를 붙여 원인을 보이게 한다(WP-2117 리뷰 후속).
    SseRegistry registry = mock(SseRegistry.class);
    registry.fanOut(List.of(9L), "resource.changed", Map.of("resource", "other", "op", "updated"));
    IllegalStateException boom = new IllegalStateException("조건 오류");
    assertThatThrownBy(
            () ->
                capture(
                    registry,
                    p -> {
                      throw boom;
                    },
                    "broken",
                    100))
        .isInstanceOf(AssertionError.class)
        .hasMessageContaining("resource.changed broken 미수신")
        .satisfies(e -> assertThat(e.getSuppressed()).containsExactly(boom));
  }

  @Test
  void predicateAssertionFailureIsTreatedAsNoMatch() {
    // 조건 안의 단언 실패도 「맞지 않음」으로 본다 — 새어 나가면 verify 가 다른 payload 에서 끊겨 맞는 이벤트를 찾지 못한다(WP-2117 리뷰 후속).
    SseRegistry registry = mock(SseRegistry.class);
    registry.fanOut(List.of(9L), "resource.changed", Map.of("resource", "other", "op", "updated"));
    registry.fanOut(List.of(1L), "resource.changed", Map.of("resource", "issue", "op", "created"));
    var captured =
        capture(
            registry,
            p -> {
              assertThat(p.get("resource")).isEqualTo("issue");
              return true;
            },
            "issue");
    assertThat(captured.recipients()).containsExactly(1L);
  }

  @Test
  void returnsFirstMatchingEvent() {
    SseRegistry registry = mock(SseRegistry.class);
    registry.fanOut(List.of(1L), "resource.changed", Map.of("resource", "issue", "op", "created"));
    registry.fanOut(List.of(2L), "resource.changed", Map.of("resource", "issue", "op", "created"));
    assertThat(capture(registry, "issue", "created").recipients()).containsExactly(1L);
  }
}
