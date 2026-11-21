package com.workplace.home.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.doAnswer;

import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.home.outbound.ChatMessages;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.core.task.support.TaskExecutorAdapter;
import tools.jackson.databind.JsonNode;

/**
 * 홈 채팅 비동기 펌프를 테스트에서 다루는 도구 — 펌프를 호출 스레드에서 돌리거나, 상한까지만 기다린다(WP-1918).
 *
 * <p>고정 5초 래치는 부하 시 flake 의 원인이라, 대기 상한을 제품 턴 상한에서 파생해 「속도 단언」이 아닌 「hang 방지」로만 쓴다.
 */
public final class HomeChatPumpTestSupport {

  /** 펌프 대기 상한 — 제품 턴 상한(300초)보다 10초 길게 잡은 hang 방지용 값. */
  public static final Duration PUMP_WAIT_LIMIT = HomeChatService.turnTimeout().plusSeconds(10);

  /** 취소 테스트가 펌프를 붙잡는 상한 — 제품 turnTimeout(300초)보다 짧아 타임아웃 취소와 구분된다. */
  public static final Duration CANCEL_HOLD_LIMIT = Duration.ofSeconds(60);

  private HomeChatPumpTestSupport() {}

  /**
   * 펌프가 호출 스레드에서 동기로 돌게 실행기를 바꾼다. 돌려준 AutoCloseable 의 close 가 원래 실행기로 되돌린다(try-with-resources 용).
   */
  public static AutoCloseable inline(HomeChatService svc) {
    AsyncTaskExecutor prev =
        svc.useExecutorForTest(
            new TaskExecutorAdapter(
                task -> {
                  // 실행 전부터 서 있던 인터럽트(JUnit @Timeout 등 펌프와 무관한 것)는 지우지 않도록 미리 기억한다.
                  boolean wasInterrupted = Thread.currentThread().isInterrupted();
                  try {
                    task.run();
                  } finally {
                    // 취소된 턴은 호출 스레드의 인터럽트 플래그를 다시 세운다. 운영의 ThreadPoolExecutor 워커는 다음 작업 전에
                    // 이 플래그를 지우므로, inline 에서도 같게 지워 JUnit 테스트 스레드가 인터럽트된 채 남지 않게 한다.
                    // 단 실행 전에 이미 서 있었다면 펌프가 세운 것이 아니므로 그대로 둔다.
                    if (!wasInterrupted) {
                      Thread.interrupted();
                    }
                  }
                }));
    return () -> svc.useExecutorForTest(prev);
  }

  /** 호출 사용자(userId)의 ChatRequest 만 받는 Mockito 매처 — composeStream 스텁이 다른 사용자 호출을 가로채지 않게 거른다. */
  public static ChatMessages.ChatRequest forUser(long uid) {
    return argThat((ChatMessages.ChatRequest r) -> r.userId() == uid);
  }

  /**
   * composeStream 이 요청 사용자(uid)의 호출에만 곧바로 done(reply) 하도록 스텁한다 — 다른 사용자의 늦은 펌프가 이 스텁을 부르지 않게 거른다.
   * 펌프를 {@link #inline} 으로 돌리면 startChat 이 돌아올 때 done 처리가 끝나 있어 래치가 필요 없다.
   */
  public static void stubDone(AiAgentChatClient chatClient, long uid, String reply)
      throws Exception {
    doAnswer(
            inv -> {
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDone.accept(reply, null);
              return null;
            })
        .when(chatClient)
        .composeStream(forUser(uid), any(), any(), any(), any(), any(), any());
  }

  /** 래치가 풀릴 때까지 {@link #PUMP_WAIT_LIMIT} 만큼 기다리고, 못 풀리면 AssertionError 를 던진다. */
  public static void awaitPump(CountDownLatch latch) throws InterruptedException {
    if (!latch.await(PUMP_WAIT_LIMIT.toMillis(), TimeUnit.MILLISECONDS)) {
      throw new AssertionError("펌프가 상한 안에 끝나지 않았다");
    }
  }
}
