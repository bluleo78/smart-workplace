package com.workplace.fileai.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.BindException;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;

/**
 * WP-250: 렌더 설정 검증 — max-edge 가 워커 범위(64~4096) 밖이면 기동(바인딩) 때 바로 실패해야 한다. 그대로 두면 모든 /view 가 워커 검증
 * 실패(422)로 막혀 503 만 나가고 원인이 로그 깊숙이 숨는다.
 */
class WorkerPropertiesRenderTest {

  private static WorkerProperties bind(String maxEdge) {
    var source =
        new MapConfigurationPropertySource(
            Map.of(
                "workplace.worker.base-url", "http://w",
                "workplace.worker.enabled", "true",
                "workplace.worker.render.max-edge", maxEdge,
                "workplace.worker.render.timeout-seconds", "20"));
    return new Binder(source).bind("workplace.worker", WorkerProperties.class).get();
  }

  @Test
  void 범위_안이면_바인딩된다() {
    assertThat(bind("1568").render().maxEdge()).isEqualTo(1568);
    assertThat(bind("64").render().maxEdge()).isEqualTo(64);
    assertThat(bind("4096").render().maxEdge()).isEqualTo(4096);
  }

  @Test
  void 범위_밖이면_분명한_메시지로_기동이_실패한다() {
    assertThatThrownBy(() -> bind("5000"))
        .isInstanceOf(BindException.class)
        .rootCause()
        .hasMessageContaining("workplace.worker.render.max-edge")
        .hasMessageContaining("64~4096");
    assertThatThrownBy(() -> bind("63")).isInstanceOf(BindException.class);
  }

  @Test
  void 타임아웃은_1초_이상이어야_한다() {
    assertThatThrownBy(() -> new WorkerProperties.Render(1568, 0))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("timeout-seconds");
  }
}
