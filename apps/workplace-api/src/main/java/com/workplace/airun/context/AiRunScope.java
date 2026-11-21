package com.workplace.airun.context;

import java.util.function.Supplier;

/**
 * 현재 스레드의 AI 처리 맥락 범위 (WP-1829).
 *
 * <p>왜: 서비스 호출 사슬 깊은 곳의 ai-agent 클라이언트까지 대상·주체를 인자로 끌고 다니지 않고, 호출 바깥에서 범위만 열어 두면 클라이언트가 {@link
 * #current()} 로 읽게 한다. 중첩되면 안쪽 값이 우선이고, 끝나면(예외 포함) 바깥 값으로 돌아간다.
 */
public final class AiRunScope {

  private static final ThreadLocal<AiRunContext> CURRENT = new ThreadLocal<>();

  private AiRunScope() {}

  /** ctx 를 현재 맥락으로 두고 s 를 실행한다. 끝나면 이전 값을 복원한다. */
  public static <T> T call(AiRunContext ctx, Supplier<T> s) {
    AiRunContext previous = CURRENT.get();
    CURRENT.set(ctx);
    try {
      return s.get();
    } finally {
      // 이전 값이 없었으면 제거해 스레드 풀 재사용 시 맥락이 새지 않게 한다.
      if (previous == null) {
        CURRENT.remove();
      } else {
        CURRENT.set(previous);
      }
    }
  }

  /** 반환값이 없는 {@link #call}. */
  public static void run(AiRunContext ctx, Runnable r) {
    call(
        ctx,
        () -> {
          r.run();
          return null;
        });
  }

  /** 현재 맥락. 범위 밖이면 빈 맥락. */
  public static AiRunContext current() {
    AiRunContext c = CURRENT.get();
    return c != null ? c : AiRunContext.empty();
  }
}
