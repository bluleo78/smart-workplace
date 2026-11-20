package com.workplace.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.awaitility.Awaitility.await;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.service.MessagingAttentionService;
import com.workplace.support.AsyncPools;
import com.workplace.support.ExternalClientMockedTestBase;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/** WP-1818: 어텐션 분류가 전용 풀에서 돌고, 그 풀이 가득 차도 이벤트 발사 풀에 영향이 없음을 검증한다. */
@ExtendWith(OutputCaptureExtension.class)
class MessagingAttentionExecutorTest extends ExternalClientMockedTestBase {

  @Autowired
  @Qualifier("messagingAttentionExecutor")
  Executor attention;

  @Autowired
  @Qualifier("aiAgentEventExecutor")
  Executor events;

  @Autowired MessagingAttentionService svc;

  /** 전용 풀의 크기·이름·테넌트 데코레이터 값을 확인한다. */
  @Test
  void attentionExecutor_isDedicatedBoundedPool() throws Exception {
    var pool = (ThreadPoolTaskExecutor) attention;
    assertThat(pool).isNotSameAs(events);
    assertThat(pool.getCorePoolSize()).isEqualTo(2);
    assertThat(pool.getMaxPoolSize()).isEqualTo(2);
    assertThat(pool.getQueueCapacity()).isEqualTo(50);
    assertThat(pool.getThreadNamePrefix()).isEqualTo("messaging-attention-");

    // 데코레이터 동작 검증 — 제출 스레드의 테넌트가 워커에서 보이는지, 워커 스레드 이름이 전용 풀인지 본다.
    AtomicReference<Long> seenTenant = new AtomicReference<>();
    AtomicReference<String> seenThread = new AtomicReference<>();
    CountDownLatch ran = new CountDownLatch(1);
    TenantContext.set(1L);
    try {
      attention.execute(
          () -> {
            seenTenant.set(TenantContext.get());
            seenThread.set(Thread.currentThread().getName());
            ran.countDown();
          });
      assertThat(ran.await(5, TimeUnit.SECONDS)).isTrue();
    } finally {
      TenantContext.clear();
    }
    assertThat(seenTenant.get()).isEqualTo(1L);
    assertThat(seenThread.get()).startsWith("messaging-attention-");
  }

  /** onChannelMessage 의 @Async 대상이 전용 풀인지 확인한다. */
  @Test
  void onChannelMessage_runsOnAttentionExecutor() throws Exception {
    Async async =
        MessagingAttentionService.class
            .getMethod("onChannelMessage", long.class)
            .getAnnotation(Async.class);
    assertThat(async.value()).isEqualTo("messagingAttentionExecutor");
  }

  /** 어텐션 풀이 가득 차도 호출은 예외 없이 돌아오고 이벤트 풀은 일을 받는다. */
  @Test
  void fullAttentionPool_doesNotRejectEventDispatch(CapturedOutput output) throws Exception {
    var pool = (ThreadPoolTaskExecutor) attention;
    var tp = pool.getThreadPoolExecutor();
    CountDownLatch release = new CountDownLatch(1);
    CountDownLatch done = new CountDownLatch(1);
    try {
      // 2 스레드 + 큐 50 을 풀리지 않는 일로 채운다(52건).
      for (int i = 0; i < 52; i++) {
        attention.execute(
            () -> {
              try {
                release.await();
              } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
              }
            });
      }
      // 두 스레드가 모두 일을 잡고 큐가 가득 찰 때까지 기다린다.
      await()
          .atMost(Duration.ofSeconds(3))
          .until(() -> tp.getActiveCount() == 2 && tp.getQueue().size() == 50);

      assertThatCode(() -> svc.onChannelMessage(Long.MAX_VALUE)).doesNotThrowAnyException();
      // 전용 풀로 라우팅돼 큐 초과로 버려졌음을 거절 로그로 증명한다(옛 코드는 이 로그가 없다).
      assertThat(output.getAll()).contains("[messaging-attention] 실행 큐 초과");

      events.execute(done::countDown);
      assertThat(done.await(3, TimeUnit.SECONDS)).isTrue();
    } finally {
      release.countDown();
      AsyncPools.awaitIdle(attention);
    }
  }
}
