package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.groups.Tuple.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.realtime.StreamingGenerationRegistry;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.dto.HomeChatStartedResponse;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BiConsumer;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * WP-190 홈 채팅 턴 종결 — 모든 home.chat 이벤트의 sessionId 봉투, 취소(cancelled{reason}+구 호환 error)·오류 종결의 부분 답변
 * 저장 (STOPPED·FAILED), "영속 → 반납 → 이벤트" 순서. @Transactional 을 쓰지 않는다(펌프 스레드 커밋 필요) — 만든
 * 사용자는 @AfterEach 에서 회수(#512).
 */
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class HomeChatTerminalTest extends IntegrationTestBase {

  @Autowired HomeChatService chatService;
  @Autowired HomeSessionService sessionService;
  @Autowired StreamingGenerationRegistry registry;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @MockitoBean AiAgentChatClient chatClient;
  @MockitoBean AssistantResolver assistantResolver;
  @MockitoBean SseRegistry sseRegistry;
  @MockitoBean TenantScopedRunner tenantScopedRunner;

  private final List<Long> users = new ArrayList<>();

  /** fanOut 을 (이벤트, payload) 로 모은다. */
  private final List<Map.Entry<String, Map<String, Object>>> events = new CopyOnWriteArrayList<>();

  @BeforeEach
  void captureEvents() {
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
    doAnswer(
            inv -> {
              @SuppressWarnings("unchecked")
              Map<String, Object> p = (Map<String, Object>) inv.getArgument(2);
              events.add(Map.entry(inv.getArgument(1), p));
              return null;
            })
        .when(sseRegistry)
        .fanOut(any(), any(), any());
  }

  /** 슬롯이 모두 빠질 때까지 기다린 뒤 사용자를 회수한다 — 다음 테스트가 aiChatStreamExecutor 대기열 뒤에 서지 않게. */
  @AfterEach
  void cleanup() throws Exception {
    for (long u : users) awaitTrue(() -> registry.active(u, HomeChatService.scope()).isEmpty());
    if (!users.isEmpty()) dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
  }

  private static void awaitTrue(BooleanSupplier cond) throws InterruptedException {
    long deadline = System.currentTimeMillis() + 5000;
    while (!cond.getAsBoolean()) {
      if (System.currentTimeMillis() > deadline) throw new AssertionError("timeout");
      Thread.sleep(20);
    }
  }

  private long user() {
    String n = "term" + System.nanoTime();
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, n)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, n)
            .set(USER.EMAIL, n + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    users.add(id);
    return id;
  }

  private List<Map<String, Object>> payloads(String event) {
    return events.stream().filter(e -> e.getKey().equals(event)).map(Map.Entry::getValue).toList();
  }

  @Test
  void 모든_home_chat_이벤트에_sessionId_가_실린다() throws Exception {
    long uid = user();
    CountDownLatch done = new CountDownLatch(1);
    doAnswer(
            inv -> {
              Consumer<String> onDelta = inv.getArgument(1);
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              Consumer<String> onProgress = inv.getArgument(4);
              Consumer<JsonNode> onTool = inv.getArgument(6);
              onProgress.accept("캘린더 확인 중");
              onTool.accept(
                  om.readTree("{\"phase\":\"start\",\"seq\":1,\"toolName\":\"list_events\"}"));
              onTool.accept(
                  om.readTree("{\"phase\":\"result\",\"seq\":1,\"toolName\":\"list_events\"}"));
              onDelta.accept("일정 3건");
              onDone.accept("일정 3건", null);
              done.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    HomeChatStartedResponse r = chatService.startChat(uid, null, "오늘 일정");
    assertThat(done.await(5, TimeUnit.SECONDS)).isTrue();
    awaitTrue(() -> !payloads("home.chat.done").isEmpty());

    assertThat(events)
        .extracting(Map.Entry::getKey)
        .contains("home.chat.progress", "home.chat.tool", "home.chat.delta", "home.chat.done");
    assertThat(events)
        .allSatisfy(
            e ->
                assertThat(e.getValue())
                    .containsEntry("sessionId", r.sessionId().toString())
                    .containsEntry("correlationId", r.correlationId()));
  }

  @Test
  void 오류로_끝나면_누적분을_FAILED_로_저장하고_error_를_보낸다() throws Exception {
    long uid = user();
    doAnswer(
            inv -> {
              Consumer<String> onDelta = inv.getArgument(1);
              Consumer<String> onError = inv.getArgument(3);
              onDelta.accept("반쯤 쓴 답");
              onError.accept("AI 구성 요청에 실패했어요.");
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    HomeChatStartedResponse r = chatService.startChat(uid, null, "보고서");
    awaitTrue(() -> !payloads("home.chat.error").isEmpty());

    assertThat(payloads("home.chat.error").get(0)).containsEntry("message", "AI 구성 요청에 실패했어요.");
    assertThat(sessionService.getMessages(uid, r.sessionId()))
        .extracting(
            HomeMessageResponse::role, HomeMessageResponse::content, HomeMessageResponse::status)
        .containsExactly(tuple("USER", "보고서", "COMPLETE"), tuple("ASSISTANT", "반쯤 쓴 답", "FAILED"));
  }

  /** 인터럽트로 줄 루프를 빠져나온 composeStream 은 콜백 없이 조용히 return 한다(R8) — 그 경로도 취소로 마감해야 한다. */
  @Test
  void 사용자_취소의_조용한_return_경로도_STOPPED_저장과_cancelled_user() throws Exception {
    long uid = user();
    CountDownLatch started = new CountDownLatch(1);
    doAnswer(
            inv -> {
              Consumer<String> onDelta = inv.getArgument(1);
              onDelta.accept("멈출 답 ");
              started.countDown();
              try {
                Thread.sleep(5000);
              } catch (InterruptedException e) {
                Thread.currentThread().interrupt(); // 실제 클라이언트처럼 플래그만 세우고 정상 return
              }
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    HomeChatStartedResponse r = chatService.startChat(uid, null, "길게 써줘");
    assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
    chatService.cancelChat(r.correlationId(), uid);
    awaitTrue(() -> !payloads("home.chat.cancelled").isEmpty());

    assertThat(payloads("home.chat.cancelled").get(0))
        .containsEntry("reason", "user")
        .containsEntry("sessionId", r.sessionId().toString());
    // 구 웹 호환 — 같은 취소를 error{cancelled:true} 로도 알린다(R6).
    awaitTrue(() -> !payloads("home.chat.error").isEmpty());
    assertThat(payloads("home.chat.error").get(0)).containsEntry("cancelled", true);
    assertThat(sessionService.getMessages(uid, r.sessionId()))
        .extracting(HomeMessageResponse::content, HomeMessageResponse::status)
        .containsExactly(tuple("길게 써줘", "COMPLETE"), tuple("멈출 답 ", "STOPPED"));
  }

  @Test
  void 첫_글자_전에_취소되면_어시스턴트_메시지를_남기지_않는다() throws Exception {
    long uid = user();
    CountDownLatch started = new CountDownLatch(1);
    doAnswer(
            inv -> {
              started.countDown();
              try {
                Thread.sleep(5000);
              } catch (InterruptedException e) {
                throw new java.io.UncheckedIOException(new java.io.IOException(e)); // 예외 경로
              }
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    HomeChatStartedResponse r = chatService.startChat(uid, null, "안녕");
    assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
    chatService.cancelChat(r.correlationId(), uid);
    awaitTrue(() -> !payloads("home.chat.cancelled").isEmpty());

    assertThat(sessionService.getMessages(uid, r.sessionId()))
        .extracting(HomeMessageResponse::role)
        .containsExactly("USER");
  }

  /** R3: done 을 내보낼 때는 이미 슬롯이 비어 있어야 한다 — done 핸들러 안에서 같은 대화로 곧바로 다시 물어 결정적으로 검증한다. */
  @Test
  void done_발행_시점엔_이미_슬롯이_비어_같은_대화로_곧바로_다시_물을_수_있다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    AtomicReference<String> outcome = new AtomicReference<>();
    AtomicBoolean tried = new AtomicBoolean(false);
    doAnswer(
            inv -> {
              if ("home.chat.done".equals(inv.getArgument(1)) && tried.compareAndSet(false, true)) {
                try {
                  chatService.startChat(uid, sid, "곧바로 다음 질문");
                  outcome.set("ok");
                } catch (Exception e) {
                  outcome.set(e.getClass().getSimpleName());
                }
              }
              return null;
            })
        .when(sseRegistry)
        .fanOut(any(), any(), any());
    doAnswer(
            inv -> {
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDone.accept("답", null);
              return null;
            })
        .doAnswer(inv -> null) // 두 번째 턴은 콜백 없이 끝난다(오류로 마감)
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    chatService.startChat(uid, sid, "첫 질문");
    awaitTrue(() -> outcome.get() != null);
    assertThat(outcome.get()).isEqualTo("ok");
  }
}
