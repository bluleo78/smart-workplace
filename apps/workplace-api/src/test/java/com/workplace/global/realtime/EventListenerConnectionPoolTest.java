package com.workplace.global.realtime;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadReadEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageReadEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessagingChannelProgressEvent;
import com.workplace.project.outbound.ProjectAudienceResolver;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageCreatedEvent;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이벤트 리스너가 요청 트랜잭션의 커넥션을 쥔 채 두 번째 커넥션을 요구하지 않는지(WP-751).
 *
 * <p>SSE 디스패처가 커밋 직후(AFTER_COMMIT) 또는 트랜잭션 안의 일반 @EventListener 에서 REQUIRES_NEW 로 새 커넥션을 빌리면, 커넥션 풀
 * 크기만큼의 쓰기가 동시에 커밋될 때 모두가 「자기 커넥션을 쥔 채 두 번째 커넥션」을 기다려 풀 타임아웃(30초)까지 멈췄다. 테스트 풀은 2개라 쓰기 2건이 각자 커넥션을
 * 잡은 상태(배리어)에서 이벤트를 내면 같은 교착이 그대로 재현된다 — 고친 뒤에는 두 쓰기가 곧바로 끝나야 한다.
 */
class EventListenerConnectionPoolTest extends IntegrationTestBase {

  /** 테스트 풀 크기(application-test.yml maximum-pool-size) — 이만큼의 쓰기가 커넥션을 하나씩 쥔다. */
  private static final int WRITERS = 2;

  /** 정상이면 수백 ms 안에 끝난다. 교착이면 풀 타임아웃(30초)까지 멈추므로 그보다 넉넉히 짧게 둔다. */
  private static final long DEADLINE_SECONDS = 10;

  @Autowired private ApplicationEventPublisher publisher;
  @Autowired private ProjectService projectService;

  static Stream<Arguments> events() {
    UserSummary actor = new UserSummary(1L, "u", "사용자", "HUMAN");
    return Stream.of(
        Arguments.of(
            "resource.changed(PROJECT)",
            (Supplier<Object>)
                () ->
                    new ResourceChangedEvent(
                        "issue",
                        "updated",
                        ProjectAudienceResolver.SCOPE,
                        1L,
                        List.of(1L),
                        Map.of(),
                        null,
                        Set.of())),
        Arguments.of(
            "wiki.page.created",
            (Supplier<Object>)
                () -> new WikiPageCreatedEvent(1L, 1L, null, "제목", null, Instant.now())),
        Arguments.of(
            "messaging.message.read",
            (Supplier<Object>) () -> new MessageReadEvent(1L, 1L, 1L, null)),
        Arguments.of(
            "chat.thread.read", (Supplier<Object>) () -> new ChatThreadReadEvent(1L, 1L, 1L)),
        Arguments.of(
            "chat.thread.typing(트랜잭션 안 @EventListener)",
            (Supplier<Object>) () -> new ChatThreadTypingEvent(1L, actor)),
        Arguments.of(
            "messaging.message.progress(트랜잭션 안 @EventListener)",
            (Supplier<Object>)
                () -> new MessagingChannelProgressEvent(1L, 2L, "AI", "s1", "working", List.of())));
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("events")
  void 풀_크기만큼_동시에_쓰기가_이벤트를_내도_두번째_커넥션을_기다리며_멈추지_않는다(String name, Supplier<Object> event)
      throws Exception {
    CyclicBarrier allHoldConnection = new CyclicBarrier(WRITERS);
    ExecutorService pool = Executors.newFixedThreadPool(WRITERS);
    try {
      List<Future<?>> writes = new ArrayList<>();
      for (int i = 0; i < WRITERS; i++) {
        writes.add(
            pool.submit(
                () -> {
                  TenantContext.set(1L);
                  try {
                    new TransactionTemplate(txManager)
                        .executeWithoutResult(
                            status -> {
                              // 커넥션을 실제로 잡는다 — 모든 쓰기가 풀의 커넥션을 하나씩 쥔 상태를 만든다.
                              baseDsl.selectOne().fetch();
                              await(allHoldConnection);
                              publisher.publishEvent(event.get());
                            });
                  } finally {
                    TenantContext.clear();
                  }
                  return null;
                }));
      }
      for (Future<?> w : writes) {
        // 교착이면 여기서 TimeoutException — 풀 타임아웃을 기다리지 않고 실패로 드러낸다.
        w.get(DEADLINE_SECONDS, TimeUnit.SECONDS);
      }
      assertThat(writes).allMatch(Future::isDone);
    } finally {
      pool.shutdownNow();
      pool.awaitTermination(40, TimeUnit.SECONDS);
    }
  }

  @Test
  void 프로젝트_목록을_풀_크기만큼_동시에_조회해도_멈추지_않는다() throws Exception {
    // 커밋되는 HUMAN 사용자 — 목록 조회가 기본 개인 프로젝트를 별도 트랜잭션으로 커밋하므로 테스트 롤백으로 격리할 수 없다.
    TenantContext.set(1L);
    long userId;
    try {
      userId =
          new TransactionTemplate(txManager)
              .execute(
                  s -> {
                    long id = TestFixtures.createHuman(baseDsl);
                    TestFixtures.addMember(baseDsl, id, 1L);
                    return id;
                  });
      // 기본 개인 프로젝트를 먼저 만들어 둔다 — 이후 목록 조회는 확인만 해야 한다(예전엔 매번 REQUIRES_NEW 로 두 번째 커넥션을 빌렸다).
      projectService.list(userId, 0, 20);
    } finally {
      TenantContext.clear();
    }
    ExecutorService pool = Executors.newFixedThreadPool(WRITERS);
    try {
      List<Future<?>> reads = new ArrayList<>();
      CyclicBarrier together = new CyclicBarrier(WRITERS);
      for (int i = 0; i < WRITERS; i++) {
        reads.add(
            pool.submit(
                () -> {
                  TenantContext.set(1L);
                  try {
                    await(together);
                    // 같은 순간에 들어가도록 여러 번 반복 — 둘 다 바깥 커넥션을 쥔 채 두 번째를 기다리는 겹침을 만든다.
                    for (int k = 0; k < 20; k++) projectService.list(userId, 0, 20);
                  } finally {
                    TenantContext.clear();
                  }
                  return null;
                }));
      }
      for (Future<?> r : reads) r.get(DEADLINE_SECONDS, TimeUnit.SECONDS);
    } finally {
      pool.shutdownNow();
      pool.awaitTermination(40, TimeUnit.SECONDS);
      cleanupInTenant(
          1L,
          () -> {
            baseDsl.deleteFrom(PROJECT).where(PROJECT.OWNER_ID.eq(userId)).execute();
            baseDsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
          });
    }
  }

  private static void await(CyclicBarrier barrier) {
    try {
      barrier.await(DEADLINE_SECONDS, TimeUnit.SECONDS);
    } catch (Exception e) {
      throw new IllegalStateException("모든 쓰기가 커넥션을 잡지 못함", e);
    }
  }
}
