package com.workplace.agentruntime.screen;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

/**
 * 작업 화면 중계({@link AgentScreenRelay})와 파드 사이 넘기기({@link AgentScreenForwarder})가 함께 쓰는 소켓
 * 도우미(WP-1978) — 두 곳에 같은 코드가 따로 있으면 쓰기 상한 같은 값이 어긋나기 쉬워 한곳에 모은다.
 */
@Slf4j
final class ScreenSockets {

  /** 소켓 쓰기 상한 — 한 번의 보내기가 이보다 오래 걸리거나 밀린 양이 넘치면 그 소켓을 끊는다(느린 쪽이 중계 스레드를 붙잡지 않게). */
  static final int SEND_TIME_LIMIT_MS = 10_000;

  /** 데코레이터가 쌓아 둘 수 있는 보내기 버퍼 상한(바이트). */
  static final int SEND_BUFFER_LIMIT = 1024 * 1024;

  /**
   * 끝남 알림 보낸 뒤 소켓을 닫기 전에 데코레이터 버퍼가 비기를 기다리는 상한(WP-2015) — 보내는 중에 닫으면 남은 프레임이 버려진다. 기한이 지나면 그냥
   * 닫는다(핸들러 스레드에서 불리므로 오래 멈추지 않는다 — 중계의 타이머·종료 경로는 별도 스레드로 넘긴다). 중계와 넘기기 관이 같은 값을 쓴다(WP-1978 리뷰 후속
   * ②).
   */
  static final int ENDED_DRAIN_TIMEOUT_MS = 2_000;

  /**
   * 위 드레인 대기의 폴링 간격 — 프레임이 나가는 순간을 놓치지 않게 짧게 확인한다. 라이브러리는 쓰기 시작한 그 밀리초에 진행 중인 보내기를 0 으로 보여 줘 첫 관찰의
   * 유휴은 오판일 수 있어, 유휴를 두 번 관찰할 때까지 한 번은 반드시 이 간격만큼 기다린다 — 그래서 보내는 중이 아닌 닫기에도 이 간격 한 번(최소 한 폴링)이
   * 든다(WP-2015 리뷰 후속 ④ — 유휴 오판을 막는 값이라 줄이지 않는다).
   */
  static final int ENDED_DRAIN_POLL_MS = 20;

  private ScreenSockets() {}

  /** 동시 보내기에 안전하도록 소켓을 쓰기 상한이 있는 데코레이터로 감싼다. */
  static WebSocketSession decorate(WebSocketSession raw) {
    return new ConcurrentWebSocketSessionDecorator(raw, SEND_TIME_LIMIT_MS, SEND_BUFFER_LIMIT);
  }

  /**
   * 바이너리 프레임의 내용을 복사한다 — 보내기가 밀려 버퍼에 쌓이면 컨테이너가 다시 쓰는 수신 버퍼를 나중에 읽게 되므로, 넘기기 전에 떼어 둔다. 원본의 위치는 건드리지
   * 않는다(읽기 전용 사본에서 읽음).
   */
  static byte[] copy(BinaryMessage message) {
    ByteBuffer buf = message.getPayload().asReadOnlyBuffer();
    byte[] bytes = new byte[buf.remaining()];
    buf.get(bytes);
    return bytes;
  }

  /** 소켓을 닫되 실패는 삼킨다 — 없거나 이미 닫힌 소켓은 건너뛴다. */
  static void closeQuietly(WebSocketSession s, CloseStatus status) {
    if (s == null || !s.isOpen()) return;
    try {
      s.close(status);
    } catch (IOException | RuntimeException e) {
      // 이미 끊긴 소켓 — 더 할 것이 없다.
    }
  }

  /** 이름 붙은 데몬 스레드 하나로 도는 스케줄러 — 서버 종료를 붙들지 않게 데몬으로 만든다. */
  static ScheduledExecutorService daemonScheduler(String threadName) {
    return Executors.newSingleThreadScheduledExecutor(daemon(threadName));
  }

  /** 이름 붙은 데몬 스레드들로 도는 캐시 풀 — 작업마다 스레드를 쓰고 쉬는 스레드는 거둔다. */
  static ExecutorService daemonCachedPool(String threadName) {
    return Executors.newCachedThreadPool(daemon(threadName));
  }

  /** 주어진 이름의 데몬 스레드를 만드는 팩토리. */
  private static ThreadFactory daemon(String threadName) {
    return r -> {
      Thread t = new Thread(r, threadName);
      t.setDaemon(true);
      return t;
    };
  }

  /**
   * 마지막 프레임이 데코레이터 버퍼에 남아 있는 동안 소켓을 닫으면 그 프레임이 사라진다(WP-2015) — 나갈 때까지만 기다리고, 기한이 지나면 그냥 닫는다. 기다리는
   * 동안 부른 스레드를 붙잡으므로(최대 {@link #ENDED_DRAIN_TIMEOUT_MS}) 단일 스레드 타이머에서는 부르지 않는다.
   */
  static void closeQuietlyAfterDrain(WebSocketSession s, CloseStatus status) {
    drainBeforeClose(s);
    closeQuietly(s, status);
  }

  /**
   * 닫기 전에 데코레이터에 남은 마지막 프레임이 나갈 때만 기다린다 — 느린 소켓을 무한히 기다리지 않는다. 보내는 중이 아닌 닫기에서도 유휴를 두 번 관찰할 때까지
   * {@link #ENDED_DRAIN_POLL_MS} 한 번은 기다린다(첫 관찰의 유휴가 오판일 수 있어 — 위 상수 설명, WP-2015 리뷰 후속 ④).
   */
  private static void drainBeforeClose(WebSocketSession s) {
    if (s == null || !s.isOpen()) return;
    if (!(s instanceof ConcurrentWebSocketSessionDecorator d)) return;
    long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(ENDED_DRAIN_TIMEOUT_MS);
    // 버퍼가 비고 진행 중인 보내기가 끝날 때까지 기다린다 — 그 동안 앞선 보내기 스레드가 끝남 알림까지 밀어낸다.
    // 라이브러리는 쓰기 시작한 그 밀리초에 진행 중인 보내기를 0 으로 보여 줘 오판할 수 있으므로(WP-2015),
    // 한 번 유휴을 관찰한 뒤 ENDED_DRAIN_POLL_MS 가 지난 재확인에서도 유휴일 때만 나간다(오탐은 그 재확인에서 잡는다).
    boolean idleOnPreviousPoll = false;
    int previousBuffer = -1;
    while (System.nanoTime() < deadline) {
      int buffer = d.getBufferSize();
      long sinceSendStarted = d.getTimeSinceSendStarted();
      boolean idle = buffer == 0 && sinceSendStarted == 0;
      if (idle && idleOnPreviousPoll) return;
      idleOnPreviousPoll = idle;
      // 진행 중인 보내기는 없는데 버퍼만 남아 두 폴링 동안 줄지 않으면 — 그 버퍼를 비울 주체가 없어 기한을 채워도 프레임은 나가지 않는다.
      // 보내기 실패(한도 초과 등) 뒤에 닫히는 스레드가 2초를 헛대기하지 않게 한다(WP-2015 리뷰 후속 ②).
      if (!idle && sinceSendStarted == 0 && buffer > 0 && buffer == previousBuffer) return;
      previousBuffer = buffer;
      try {
        Thread.sleep(ENDED_DRAIN_POLL_MS);
      } catch (InterruptedException e) {
        // 대기 중 끊김 — 플래그를 되돌리고 닫기를 미루지 않는다.
        Thread.currentThread().interrupt();
        return;
      }
    }
    // 기한을 채워 나간다 — 끝남 프레임이 아직 나가지 못했을 수 있다(WP-2015): 유실 흔적을 남긴다.
    log.debug(
        "작업 화면 끝남 프레임 대기 초과 buffer={} timeSince={}",
        d.getBufferSize(),
        d.getTimeSinceSendStarted());
  }
}
