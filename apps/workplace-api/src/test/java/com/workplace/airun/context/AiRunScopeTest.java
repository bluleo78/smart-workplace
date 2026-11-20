package com.workplace.airun.context;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** AiRunScope 단위 테스트 — 범위 안/밖, 중첩, 예외 후 복원 (WP-1829). */
class AiRunScopeTest {

  private static AiRunContext ctx(String id) {
    return new AiRunContext("T", id, null, null, null, null);
  }

  @Test
  void 범위_안에서는_ctx_밖에서는_empty() {
    AiRunContext a = ctx("1");
    AiRunContext inside = AiRunScope.call(a, AiRunScope::current);
    assertThat(inside).isSameAs(a);
    assertThat(AiRunScope.current()).isEqualTo(AiRunContext.empty());
  }

  @Test
  void 중첩하면_안쪽_값_끝나면_바깥_값() {
    AiRunContext outer = ctx("outer");
    AiRunContext inner = ctx("inner");
    AiRunScope.run(
        outer,
        () -> {
          assertThat(AiRunScope.current()).isSameAs(outer);
          AiRunScope.run(inner, () -> assertThat(AiRunScope.current()).isSameAs(inner));
          assertThat(AiRunScope.current()).isSameAs(outer);
        });
    assertThat(AiRunScope.current()).isEqualTo(AiRunContext.empty());
  }

  @Test
  void 예외가_나도_앞_값으로_돌아온다() {
    AiRunContext outer = ctx("outer");
    AiRunScope.run(
        outer,
        () -> {
          assertThatThrownBy(
                  () ->
                      AiRunScope.call(
                          ctx("inner"),
                          () -> {
                            throw new IllegalStateException("boom");
                          }))
              .isInstanceOf(IllegalStateException.class);
          assertThat(AiRunScope.current()).isSameAs(outer);
        });
    assertThat(AiRunScope.current()).isEqualTo(AiRunContext.empty());
  }
}
