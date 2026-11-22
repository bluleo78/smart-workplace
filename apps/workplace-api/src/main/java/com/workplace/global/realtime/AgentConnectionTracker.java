package com.workplace.global.realtime;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 이 파드에 붙은 AI 의 연결 시각을 DB(agent_connection)에 남기는 쓰는 쪽(WP-1975). 「외부 AI 연결됨」은 파드마다 다른 SSE 메모리로는 판정할
 * 수 없어, 각 파드가 자기에게 붙은 AI 만 1분마다 적고 읽는 쪽은 표 하나만 본다.
 *
 * <p>추적 대상은 AI 만이라 사람 연결은 DB 를 부르지 않는다. 연결이 끊긴 AI 는 한 번 더 적은 뒤 잊는다 — 끊긴 뒤 첫 쓰기의 시각을 마지막 확인 시각으로 남기기
 * 위해서다(최대 1분 뒤. 그 쓰기가 실패하면 앞서 성공한 시각이 남는다). 주기 쓰기는 공용 {@code @Scheduled} 풀(스레드 4개)이 아니라 이 기록기만의 타이머
 * 스레드에서 돈다 — 공용 풀을 AI 호출 같은 긴 작업이 메우면 쓰기가 밀려 유예(3분)가 지나 붙어 있는 AI 가 끊김으로 보이기 때문이다. DB 오류는 SSE 를 깨지
 * 않는다(경고 로그만) — 아직 붙어 있는 AI 는 집합에 남아 다음 주기에 다시 쓴다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AgentConnectionTracker {

  /** 이 파드에서 연결됐고 아직 잊지 않은 AI. */
  private final Set<Long> agents = ConcurrentHashMap.newKeySet();

  /** 주기 쓰기 간격(초). */
  static final long FLUSH_PERIOD_SECONDS = 60;

  static final String TIMER_THREAD_NAME = "agent-connection-timer";

  /** 종료 때 진행 중인 쓰기를 기다리는 최대 시간(초). */
  private static final long SHUTDOWN_WAIT_SECONDS = 3;

  private final SseRegistry registry;
  private final AgentConnectionRepository repository;

  /** 주기 쓰기 타이머 — start 전(테스트가 직접 만든 경우 포함)에는 null. */
  private ScheduledExecutorService timer;

  /** 빈이 만들어지면 주기 쓰기를 시작한다. 생성자가 아니라 여기서 시작해 테스트가 직접 만들 때는 스레드가 뜨지 않는다. */
  @PostConstruct
  void start() {
    start(TimeUnit.SECONDS.toMillis(FLUSH_PERIOD_SECONDS));
  }

  /** 주어진 간격(밀리초)으로 주기 쓰기를 시작한다 — 테스트가 60초를 기다리지 않게 간격을 받는다. */
  void start(long periodMillis) {
    timer =
        Executors.newSingleThreadScheduledExecutor(
            r -> {
              Thread t = new Thread(r, TIMER_THREAD_NAME);
              t.setDaemon(true);
              return t;
            });
    timer.scheduleAtFixedRate(this::runSafely, periodMillis, periodMillis, TimeUnit.MILLISECONDS);
  }

  /**
   * 한 회차에서 무엇이 새도 다음 회차가 돌게 삼키고 남긴다 — executor 는 어떤 Throwable 이든 난 주기 작업을 더는 돌리지 않는다.
   * RuntimeException 만 잡으면 Error(StackOverflowError 등) 하나에 타이머가 소리 없이 멈추고, 이 파드의 AI 가 연결돼 있어도 3분 뒤
   * 모두 「연결 끊김」으로 보인다.
   */
  private void runSafely() {
    try {
      flush();
    } catch (Throwable e) {
      log.warn("AI 연결 시각 주기 기록 실패 — 다음 주기에 다시 한다", e);
    }
  }

  /**
   * AI 가 연결됐다 — 추적에 넣고 바로 적는다(1분을 기다리면 막 붙은 AI 가 그동안 끊김으로 보인다). 호출부는 SSE 등록 뒤에 컨트롤러에서 부른다 — 등록·정리
   * 콜백(map compute 락) 안에서 DB 를 부르면 안 된다(WP-751). 쓰기 실패는 던지지 않는다.
   */
  public void connected(long agentId) {
    agents.add(agentId);
    write(List.of(agentId));
  }

  /**
   * 추적 중인 AI 의 시각을 적는다. 연결이 끊긴 AI 는 이번이 마지막 쓰기라 쓰고 나면 잊는다. 아래 순서는 바꾸면 안 된다 — 각 단계가 서로 다른 경우를 지킨다.
   *
   * <ol>
   *   <li>끊김 여부는 쓰기 <b>전에</b> 가린다. 쓰는 도중 끊긴 AI 는 가려낼 때 아직 연결돼 있었으니 잊지 않고 남아, 다음 flush 가 끊긴 뒤의 마지막
   *       쓰기를 한다. 쓴 뒤에 가리면 쓰기 시점엔 연결돼 있던 AI 를 끊김으로 보고 마지막 쓰기 없이 바로 잊는다.
   *   <li>잊을 때는 <b>먼저 빼고 나서 다시 확인</b>한다. 확인한 뒤에 빼면 그 사이에 다시 붙은 AI 가 연결돼 있는데도 추적에서 빠지지만, 빼고 나서 확인하면
   *       빼는 사이 다시 붙은 AI 를 도로 넣는다(다시 붙는 쪽의 {@link #connected} 가 넣는 것과 겹쳐도 집합이라 한 번이다).
   *   <li>끊긴 AI 는 쓰기가 <b>실패해도</b> 잊는다. 남겨 두었다가 DB 가 돌아온 뒤 적으면 한참 전에 끊긴 AI 가 그 시각부터 유예(3분) 동안 연결로
   *       보인다. 붙어 있는 AI 는 남아 다음 주기에 다시 쓴다.
   * </ol>
   */
  public void flush() {
    List<Long> held = List.copyOf(agents);
    if (held.isEmpty()) return;
    // (1) 쓰기 전에 끊긴 AI 를 가려 둔다.
    List<Long> gone = held.stream().filter(id -> !registry.isConnected(id)).toList();
    // (3) 실패해도 끊긴 AI 는 잊는다.
    write(held);
    for (Long id : gone) {
      // (2) 먼저 뺀 뒤 다시 확인 — 빼는 사이 다시 붙은 AI 는 도로 넣는다.
      agents.remove(id);
      if (registry.isConnected(id)) agents.add(id);
    }
  }

  /** 종료 때 타이머를 멈추고(진행 중인 쓰기는 끊지 않고 잠깐 기다린다) 한 번 더 적어 마지막 연결 시각을 남긴다. */
  @PreDestroy
  void shutdown() {
    if (timer != null) {
      timer.shutdown();
      try {
        timer.awaitTermination(SHUTDOWN_WAIT_SECONDS, TimeUnit.SECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }
    flush();
  }

  /** DB 에 적는다. 실패는 경고만 남긴다 — SSE 접속·주기 쓰기를 깨지 않는다. */
  private void write(List<Long> ids) {
    try {
      repository.touch(ids);
    } catch (RuntimeException e) {
      log.warn("AI 연결 시각 기록 실패 — 붙어 있는 AI 는 다음 주기에 다시 적는다 agents={}", ids, e);
    }
  }
}
