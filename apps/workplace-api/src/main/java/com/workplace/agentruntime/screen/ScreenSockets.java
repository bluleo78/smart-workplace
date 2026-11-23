package com.workplace.agentruntime.screen;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

/**
 * 작업 화면 중계({@link AgentScreenRelay})와 파드 사이 넘기기({@link AgentScreenForwarder})가 함께 쓰는 소켓
 * 도우미(WP-1978) — 두 곳에 같은 코드가 따로 있으면 쓰기 상한 같은 값이 어긋나기 쉬워 한곳에 모은다.
 */
final class ScreenSockets {

  /** 소켓 쓰기 상한 — 한 번의 보내기가 이보다 오래 걸리거나 밀린 양이 넘치면 그 소켓을 끊는다(느린 쪽이 중계 스레드를 붙잡지 않게). */
  static final int SEND_TIME_LIMIT_MS = 10_000;

  /** 데코레이터가 쌓아 둘 수 있는 보내기 버퍼 상한(바이트). */
  static final int SEND_BUFFER_LIMIT = 1024 * 1024;

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
}
