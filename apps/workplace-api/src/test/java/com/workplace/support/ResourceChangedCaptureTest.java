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
    assertThatThrownBy(() -> capture(registry, "issue", "deleted"))
        .isInstanceOf(AssertionError.class)
        .hasMessageContaining("resource.changed issue/deleted 미수신");
  }

  @Test
  void returnsFirstMatchingEvent() {
    SseRegistry registry = mock(SseRegistry.class);
    registry.fanOut(List.of(1L), "resource.changed", Map.of("resource", "issue", "op", "created"));
    registry.fanOut(List.of(2L), "resource.changed", Map.of("resource", "issue", "op", "created"));
    assertThat(capture(registry, "issue", "created").recipients()).containsExactly(1L);
  }
}
