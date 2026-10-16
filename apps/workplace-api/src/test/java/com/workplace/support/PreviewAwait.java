package com.workplace.support;

import java.util.function.Supplier;

/** 미리보기 변환(비동기 실행기) 테스트의 상태 폴링 도우미 — 드라이브·메일 테스트가 같은 상한·간격으로 기다린다(WP-432). */
public final class PreviewAwait {

  private PreviewAwait() {}

  /**
   * 상태가 기대값이 될 때까지 기다린다(상한 5초·50ms 간격).
   *
   * @param currentStatus 지금 상태를 읽는다(행이 없으면 null)
   * @throws AssertionError 시간 안에 이르지 못하면 — 마지막 상태를 함께 남긴다
   */
  public static void awaitStatus(Supplier<String> currentStatus, String expected) {
    long deadline = System.currentTimeMillis() + 5_000;
    String last = null;
    while (System.currentTimeMillis() < deadline) {
      last = currentStatus.get();
      if (expected.equals(last)) {
        return;
      }
      try {
        Thread.sleep(50);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new IllegalStateException(e);
      }
    }
    throw new AssertionError("상태 " + expected + " 를 기다리다 시간 초과 — 마지막 상태: " + last);
  }
}
