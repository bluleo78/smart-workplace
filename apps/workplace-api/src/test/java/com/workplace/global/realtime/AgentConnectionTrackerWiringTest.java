package com.workplace.global.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.lang.reflect.Field;
import java.time.Duration;
import java.util.Collection;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

/**
 * AgentConnectionTracker 의 배선(운영에서 주기 쓰기를 일으키는 유일한 길) 테스트 — 단위 테스트는 start()/shutdown() 을 직접 불러
 * 애노테이션이 지워져도 통과하므로, 가벼운 Spring 컨텍스트(@SpringBootTest 아님, DB 없음)로 빈 생성·종료를 거친다.
 */
class AgentConnectionTrackerWiringTest {

  private static final long ID = 7L;

  /** 지금 살아 있는 기록기 타이머 스레드 — 같은 JVM 의 다른 컨텍스트·앞 테스트 것도 섞여 있다. */
  private static Set<Thread> timerThreads() {
    return Thread.getAllStackTraces().keySet().stream()
        .filter(t -> AgentConnectionTracker.TIMER_THREAD_NAME.equals(t.getName()) && t.isAlive())
        .collect(Collectors.toSet());
  }

  private static Collection<Long> containing(long id) {
    return argThat(c -> c.contains(id));
  }

  @Test
  void beanCreation_startsTimer_andContextClose_writesHeldIds() throws InterruptedException {
    AgentConnectionRepository repository = mock(AgentConnectionRepository.class);
    SseRegistry registry = mock(SseRegistry.class);
    Set<Thread> before = timerThreads();
    Thread timer;

    AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
    context.registerBean(AgentConnectionRepository.class, () -> repository);
    context.registerBean(SseRegistry.class, () -> registry);
    context.registerBean(AgentConnectionTracker.class);
    context.refresh();
    try {
      // @PostConstruct — 빈이 만들어지면 타이머 스레드가 하나 뜬다.
      // 수가 아니라 새로 뜬 스레드로 본다 — 앞 테스트의 스레드가 그사이 끝나면 수는 흔들린다.
      Set<Thread> started = timerThreads();
      started.removeAll(before);
      assertThat(started).hasSize(1);
      timer = started.iterator().next();
      context.getBean(AgentConnectionTracker.class).connected(ID);
      reset(repository);
    } finally {
      context.close();
    }
    // @PreDestroy — 컨텍스트가 닫히면 붙어 있던 id 를 한 번 더 적는다.
    verify(repository, times(1)).touch(containing(ID));
    timer.join(3000); // awaitTermination 은 스레드가 다 끝나기 조금 전에 돌아온다
    assertThat(timer.isAlive()).isFalse();
  }

  @Test
  void productionPeriod_isAtMostAThirdOfGrace() throws Exception {
    // 유예(RECONNECT_GRACE)는 issue 패키지 소유라 global 이 import 하지 않고 리플렉션으로 실제 값을 읽는다.
    Class<?> service = Class.forName("com.workplace.issue.service.AiAgentStatusService");
    Field field = service.getDeclaredField("RECONNECT_GRACE");
    field.setAccessible(true);
    Duration grace = (Duration) field.get(null);

    // 한두 번 쓰기가 늦거나 실패해도 붙어 있는 AI 가 끊김으로 보이지 않도록 간격은 유예의 1/3 이하여야 한다.
    assertThat(Duration.ofSeconds(AgentConnectionTracker.FLUSH_PERIOD_SECONDS).multipliedBy(3))
        .isLessThanOrEqualTo(grace);
  }
}
