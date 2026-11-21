package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.realtime.StreamingGenerationRegistry;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeSessionSummary;
import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.support.ExternalClientMockedTestBase;
import java.io.InterruptedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BiConsumer;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.JsonNode;

/**
 * HomeChatPumpTestSupport.inline 검증(WP-1918) — 펌프가 호출 스레드에서 동기로 끝나고, 예외가 새지 않으며, close 가 원래 실행기로
 * 되돌리는지 본다. 펌프가 별도 tx 로 커밋하므로 @Transactional 을 쓰지 않는다.
 */
class HomeChatPumpInlineTest extends ExternalClientMockedTestBase {

  @Autowired HomeChatService composeService;
  @Autowired HomeSessionService sessionService;
  @Autowired DSLContext dsl;
  @Autowired AiAgentChatClient chatClient;
  @Autowired AssistantResolver assistantResolver;
  @Autowired StreamingGenerationRegistry registry;

  private final List<Long> createdUserIds = new ArrayList<>();

  /** 펌프가 커밋한 세션은 user 삭제로 CASCADE 회수된다. */
  @AfterEach
  void cleanupUsers() {
    if (!createdUserIds.isEmpty()) {
      dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
      createdUserIds.clear();
    }
  }

  private long user(String n) {
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, n)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, n)
            .set(USER.EMAIL, n + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    createdUserIds.add(id);
    return id;
  }

  private void stubAssistant() {
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
  }

  @Test
  void inline_이면_startChat_이_돌아올_때_펌프가_끝나_있다() throws Exception {
    long uid = user("inl" + System.nanoTime());
    stubAssistant();
    AtomicBoolean stubCalled = new AtomicBoolean();
    doAnswer(
            inv -> {
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              stubCalled.set(true);
              onDone.accept("답", null);
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    try (var ignored = HomeChatPumpTestSupport.inline(composeService)) {
      composeService.startChat(uid, null, "질문");
      // 반환 직후 — 대기 없이 곧바로 단언한다(펌프가 호출 스레드에서 끝났다는 증거).
      assertThat(stubCalled).isTrue();
      List<HomeSessionSummary> summaries = sessionService.list(uid, null, 10).items();
      assertThat(summaries).hasSize(1);
      UUID sid = summaries.get(0).id();
      List<HomeMessageResponse> msgs = sessionService.getMessages(uid, sid);
      assertThat(msgs).hasSize(2);
      assertThat(msgs.get(0).role()).isEqualTo("USER");
      assertThat(msgs.get(1).role()).isEqualTo("ASSISTANT");
      assertThat(registry.active(uid, HomeChatService.scope())).isEmpty();
    }
  }

  @Test
  void inline_중_펌프가_예외로_끝나도_호출자에게_새지_않고_슬롯을_반납한다() throws Exception {
    long uid = user("inx" + System.nanoTime());
    stubAssistant();
    doAnswer(
            inv -> {
              throw new RuntimeException("boom");
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    try (var ignored = HomeChatPumpTestSupport.inline(composeService)) {
      composeService.startChat(uid, null, "질문");
      assertThat(registry.active(uid, HomeChatService.scope())).isEmpty();
    }
  }

  @Test
  void close_하면_원래_실행기로_돌아가고_펌프_스레드에서도_테넌트가_전파돼_ASSISTANT_가_영속된다() throws Exception {
    long uid = user("inc" + System.nanoTime());
    stubAssistant();
    HomeChatPumpTestSupport.inline(composeService).close();
    AtomicReference<String> threadName = new AtomicReference<>();
    CountDownLatch done = new CountDownLatch(1);
    doAnswer(
            inv -> {
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              threadName.set(Thread.currentThread().getName());
              onDone.accept("답", null);
              done.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    composeService.startChat(uid, null, "질문");
    HomeChatPumpTestSupport.awaitPump(done);
    assertThat(threadName.get()).startsWith("ai-compose-");
    // inline 은 TenantContextTaskDecorator 를 거치지 않으므로, 실제 실행기 경로에서 펌프 스레드로 테넌트가 전파돼
    // ASSISTANT 메시지가 영속되는지(세션 메시지 USER·ASSISTANT 2개)를 여기서 지킨다. done 직후 저장되므로 폴링한다.
    UUID sid = sessionService.list(uid, null, 10).items().get(0).id();
    long deadline = System.currentTimeMillis() + HomeChatPumpTestSupport.PUMP_WAIT_LIMIT.toMillis();
    while (sessionService.getMessages(uid, sid).size() < 2
        && System.currentTimeMillis() < deadline) {
      Thread.sleep(50);
    }
    List<HomeMessageResponse> msgs = sessionService.getMessages(uid, sid);
    assertThat(msgs).hasSize(2);
    assertThat(msgs.get(1).role()).isEqualTo("ASSISTANT");
  }

  /** 실행 전부터 서 있던 인터럽트(펌프와 무관)는 inline 이 지우지 않는다. */
  @Test
  void inline_은_실행_전부터_서_있던_인터럽트_플래그를_지우지_않는다() throws Exception {
    long uid = user("inp" + System.nanoTime());
    stubAssistant();
    doAnswer(
            inv -> {
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDone.accept("답", null);
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    try (var ignored = HomeChatPumpTestSupport.inline(composeService)) {
      Thread.currentThread().interrupt();
      composeService.startChat(uid, null, "질문");
      boolean stillInterrupted = Thread.currentThread().isInterrupted();
      // 다른 테스트로 새지 않게 먼저 정리한 뒤 단언한다.
      Thread.interrupted();
      assertThat(stillInterrupted).isTrue();
    }
  }

  @Test
  void inline_중_사용자_취소로_끝난_턴이_호출_스레드의_인터럽트_플래그를_남기지_않는다() throws Exception {
    long uid = user("inf" + System.nanoTime());
    stubAssistant();
    doAnswer(
            inv -> {
              // 취소로 블로킹 read 가 끊긴 모양 — 호출 스레드(inline 이면 테스트 스레드)에 인터럽트 플래그가 선 채 던진다.
              // 취소된 턴은 이 플래그를 세운 채 끝나므로, 정리하지 않으면 이후 테스트 단계로 새어 나간다.
              Thread.currentThread().interrupt();
              throw new RuntimeException(
                  new RestClientException("io", new InterruptedIOException("interrupted")));
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    try (var ignored = HomeChatPumpTestSupport.inline(composeService)) {
      composeService.startChat(uid, null, "질문");
      assertThat(Thread.currentThread().isInterrupted()).isFalse();
    }
  }
}
