package com.workplace.mail.util;

import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * 같은 키의 작업을 프로세스 안에서 한 번만 실행한다(WP-149). 실행 중에 같은 키가 또 오면 새로 실행하지 않고 끝날 때까지(최대 maxWait) 기다린다.
 *
 * <p>왜: 동기화 직후 본문 보충·선제 백필·요약 GET 이 같은 메일을 동시에 집으면 LLM 을 두 번 부른다. 기다린 쪽은 DB 를 다시 읽어 결과를 쓴다. 저장은 조건부
 * UPDATE 라 다중 인스턴스에서도 한 번만 기록되며, 이 클래스는 중복 LLM 비용만 줄인다. 같은 키로 중첩 호출하면 자기 자신을 기다리므로 금지.
 */
public final class SingleFlight {

  private final ConcurrentHashMap<String, CompletableFuture<Void>> inFlight =
      new ConcurrentHashMap<>();
  private final Duration maxWait;

  public SingleFlight(Duration maxWait) {
    this.maxWait = maxWait;
  }

  /**
   * 키별 단일 실행.
   *
   * @return true: 이번 호출이 실행함(작업 예외는 그대로 전파). false: 다른 실행을 기다림(성공·실패·시간 초과 무관)
   */
  public boolean run(String key, Runnable task) {
    CompletableFuture<Void> mine = new CompletableFuture<>();
    CompletableFuture<Void> running = inFlight.putIfAbsent(key, mine);
    if (running != null) {
      try {
        running.get(maxWait.toMillis(), TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      } catch (ExecutionException | TimeoutException e) {
        // 다른 실행이 실패했거나 오래 걸림 — 호출자가 DB 상태로 다시 판정한다
      }
      return false;
    }
    try {
      task.run();
      return true;
    } finally {
      inFlight.remove(key, mine);
      mine.complete(null);
    }
  }
}
