package com.workplace.global.tenant;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * TenantContextTaskDecorator 단위 테스트.
 *
 * <p>제출 스레드에서 TenantContext 를 설정한 뒤 decorate(runnable).run() 으로 실행하면 Runnable 내부에서 같은 값을 읽어야 하고, 실행
 * 후에는 clear 되어야 한다.
 */
class TenantContextTaskDecoratorTest {

  private final TenantContextTaskDecorator decorator = new TenantContextTaskDecorator();

  @AfterEach
  void cleanup() {
    TenantContext.clear();
  }

  @Test
  void decorate_propagatesTenantIdToRunnable() {
    TenantContext.set(42L);
    AtomicReference<Long> captured = new AtomicReference<>();

    Runnable decorated = decorator.decorate(() -> captured.set(TenantContext.get()));
    TenantContext.clear(); // 제출 후 호출 스레드에서 정리되더라도 워커에는 전달되어야 한다
    decorated.run();

    assertThat(captured.get()).isEqualTo(42L);
  }

  @Test
  void decorate_clearsTenantContextAfterRun() {
    TenantContext.set(99L);
    Runnable decorated = decorator.decorate(() -> {});
    decorated.run();

    // 실행 후 워커 스레드(여기서는 같은 스레드)의 TenantContext 가 정리되어야 한다
    assertThat(TenantContext.get()).isNull();
  }

  @Test
  void decorate_clearsEvenWhenRunnableThrows() {
    TenantContext.set(7L);
    Runnable decorated =
        decorator.decorate(
            () -> {
              throw new RuntimeException("boom");
            });

    try {
      decorated.run();
    } catch (RuntimeException ignored) {
      // 예외는 전파되지만 TenantContext 는 정리되어야 한다
    }

    assertThat(TenantContext.get()).isNull();
  }

  @Test
  void decorate_nullTenantId_doesNotSetContext() {
    // TenantContext 없이 제출한 경우 워커에서도 null 이어야 한다
    TenantContext.clear();
    AtomicReference<Long> captured = new AtomicReference<>(-1L);

    Runnable decorated = decorator.decorate(() -> captured.set(TenantContext.get()));
    decorated.run();

    assertThat(captured.get()).isNull();
  }
}
