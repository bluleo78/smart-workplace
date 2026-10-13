package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.realtime.StreamingGenerationRegistry;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.home.outbound.AiAgentSuggestionClient;
import com.workplace.home.outbound.ChatMessages.SuggestionRequest;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.service.AiPreferenceService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * WP-139 후속 질문 — 완료 답 뒤 생성·저장·home.chat.followups 발행, 대상 아님(fallback·확인 카드·빈 답·꺼짐), 생성 중 끄기, 이력 숨김,
 * 다음 턴 맥락 제외. 펌프·실행기 스레드가 커밋해야 하므로 @Transactional 을 쓰지 않는다(HomeChatTerminalTest 와 같은 정리 방식).
 */
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class HomeFollowupTest extends IntegrationTestBase {

  @Autowired HomeChatService chatService;
  @Autowired HomeSessionService sessionService;
  @Autowired HomeContextSummaryService contextService;
  @Autowired AiPreferenceService preferences;
  @Autowired StreamingGenerationRegistry registry;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;

  @Autowired
  @Qualifier("homeSuggestionExecutor")
  ThreadPoolTaskExecutor suggestionExecutor;

  @MockitoBean AiAgentChatClient chatClient;
  @MockitoBean AiAgentSuggestionClient suggestionClient;
  @MockitoBean AssistantResolver assistantResolver;
  @MockitoBean SseRegistry sseRegistry;
  @MockitoBean TenantScopedRunner tenantScopedRunner;

  private final List<Long> users = new ArrayList<>();
  private final List<Map.Entry<String, Map<String, Object>>> events = new CopyOnWriteArrayList<>();
  private static final List<String> ITEMS =
      List.of("내일 회의 준비할 것 정리해줘", "참석자 일정 알려줘", "WP-12 상태 알려줘");

  @BeforeEach
  void setUp() {
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(
            new AssistantSpec(5L, "claude-sonnet-5-5", "NORMAL", 8, 60000, "claude-haiku-5-5"));
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

  @AfterEach
  void cleanup() throws Exception {
    for (long u : users) awaitTrue(() -> registry.active(u, HomeChatService.scope()).isEmpty());
    awaitSuggestionIdle();
    if (!users.isEmpty()) dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
  }

  private static void awaitTrue(BooleanSupplier cond) throws InterruptedException {
    long deadline = System.currentTimeMillis() + 5000;
    while (!cond.getAsBoolean()) {
      if (System.currentTimeMillis() > deadline) throw new AssertionError("timeout");
      Thread.sleep(20);
    }
  }

  /**
   * 후속 질문 실행기가 비었는가 — 제출된 작업 수와 완료 수가 같을 때. 잘못 제출된 작업이 있었다면 끝날 때까지 기다리므로 호출 여부가 확정된다 (부재 단언의 결정성).
   * activeCount+queue 판정은 워커가 작업을 꺼낸 직후 active 로 세기 전 틈이 있어 쓰지 않는다.
   */
  private void awaitSuggestionIdle() throws InterruptedException {
    var pool = suggestionExecutor.getThreadPoolExecutor();
    awaitTrue(() -> pool.getTaskCount() == pool.getCompletedTaskCount());
  }

  private long user() {
    String n = "fu" + System.nanoTime();
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

  /**
   * composeStream 스텁 — script 가 콜백을 부른 뒤 done 을 source 와 함께 보낸다. 반환 latch 는 done 처리(후속 예약 판단 포함)가
   * 끝난 뒤 열린다.
   */
  private CountDownLatch stream(String fullText, String source, boolean withProposal)
      throws Exception {
    CountDownLatch streamed = new CountDownLatch(1);
    doAnswer(
            inv -> {
              AiAgentChatClient.DoneHandler onDone = inv.getArgument(2);
              Consumer<JsonNode> onPending = inv.getArgument(5);
              if (withProposal) {
                onPending.accept(
                    om.readTree(
                        "[{\"actionType\":\"calendar.create_event\",\"summary\":\"회의 잡기\",\"params\":{}}]"));
              }
              onDone.accept(fullText, null, source);
              streamed.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());
    return streamed;
  }

  private UUID start(long uid, String query) {
    return chatService.startChat(uid, null, query).sessionId();
  }

  @Test
  void 완료_답_뒤_후속_질문을_저장하고_발행한다() throws Exception {
    long uid = user();
    when(suggestionClient.suggest(any())).thenReturn(ITEMS);
    CountDownLatch streamed = stream("내일 10시 디자인 리뷰가 있어요.", "subagent", false);
    String cid = chatService.startChat(uid, null, "내일 일정 알려줘").correlationId();
    assertThat(streamed.await(5, TimeUnit.SECONDS)).isTrue();
    awaitTrue(() -> payloads("home.chat.followups").size() == 1);

    ArgumentCaptor<SuggestionRequest> c = ArgumentCaptor.forClass(SuggestionRequest.class);
    verify(suggestionClient).suggest(c.capture());
    assertThat(c.getValue().mode()).isEqualTo("followup");
    assertThat(c.getValue().agentId()).isEqualTo(5L);
    assertThat(c.getValue().model()).isEqualTo("claude-haiku-5-5");
    assertThat(c.getValue().question()).isEqualTo("내일 일정 알려줘");
    assertThat(c.getValue().answer()).isEqualTo("내일 10시 디자인 리뷰가 있어요.");
    assertThat(c.getValue().count()).isEqualTo(3);
    assertThat(c.getValue().timeoutMs()).isEqualTo(20_000);

    Map<String, Object> p = payloads("home.chat.followups").get(0);
    assertThat(p).containsEntry("correlationId", cid).containsEntry("items", ITEMS);
    UUID sid = UUID.fromString((String) p.get("sessionId"));
    List<HomeMessageResponse> msgs = sessionService.getMessages(uid, sid);
    HomeMessageResponse answer = msgs.get(1);
    assertThat(p.get("messageId")).isEqualTo(answer.id());
    assertThat(answer.followups()).isEqualTo(ITEMS);
    assertThat(msgs.get(0).followups()).isNull();
  }

  @Test
  void 출처가_fallback_이면_후속_질문을_만들지_않는다() throws Exception {
    long uid = user();
    CountDownLatch streamed = stream("요청을 처리하지 못했어요. 다시 시도해 주세요.", "fallback", false);
    start(uid, "아무거나");
    assertThat(streamed.await(5, TimeUnit.SECONDS)).isTrue();
    awaitSuggestionIdle();
    verify(suggestionClient, never()).suggest(any());
  }

  @Test
  void 확인_카드가_있는_턴은_후속_질문을_만들지_않는다() throws Exception {
    long uid = user();
    CountDownLatch streamed = stream("회의를 준비했어요. 확인해 주세요.", "subagent", true);
    start(uid, "회의 잡아줘");
    assertThat(streamed.await(5, TimeUnit.SECONDS)).isTrue();
    awaitSuggestionIdle();
    verify(suggestionClient, never()).suggest(any());
  }

  @Test
  void 위젯만_있는_빈_답은_건너뛴다() throws Exception {
    long uid = user();
    CountDownLatch streamed = stream("", "widget", false);
    start(uid, "내 할 일");
    assertThat(streamed.await(5, TimeUnit.SECONDS)).isTrue();
    awaitSuggestionIdle();
    verify(suggestionClient, never()).suggest(any());
  }

  @Test
  void 추천을_끈_사용자는_만들지_않고_저장된_것도_숨긴다() throws Exception {
    long uid = user();
    when(suggestionClient.suggest(any())).thenReturn(ITEMS);
    CountDownLatch first = stream("답 1", "router_prose", false);
    UUID sid = start(uid, "질문 1");
    assertThat(first.await(5, TimeUnit.SECONDS)).isTrue();
    awaitTrue(() -> payloads("home.chat.followups").size() == 1);
    assertThat(sessionService.getMessages(uid, sid).get(1).followups()).isEqualTo(ITEMS);

    preferences.update(uid, false);
    assertThat(sessionService.getMessages(uid, sid).get(1).followups()).isNull();

    CountDownLatch second = stream("답 2", "router_prose", false);
    chatService.startChat(uid, sid, "질문 2");
    assertThat(second.await(5, TimeUnit.SECONDS)).isTrue();
    awaitSuggestionIdle();
    verify(suggestionClient, org.mockito.Mockito.times(1)).suggest(any());
  }

  @Test
  void 생성_중에_추천을_끄면_저장도_발행도_하지_않는다() throws Exception {
    long uid = user();
    // ai-agent 가 일하는 사이 사용자가 설정에서 끈 상황 — 생성 결과가 와도 버려야 한다.
    when(suggestionClient.suggest(any()))
        .thenAnswer(
            inv -> {
              preferences.update(uid, false);
              return ITEMS;
            });
    CountDownLatch streamed = stream("답", "subagent", false);
    UUID sid = start(uid, "질문");
    assertThat(streamed.await(5, TimeUnit.SECONDS)).isTrue();
    awaitTrue(
        () -> !org.mockito.Mockito.mockingDetails(suggestionClient).getInvocations().isEmpty());
    awaitSuggestionIdle();
    assertThat(payloads("home.chat.followups")).isEmpty();
    preferences.update(uid, true);
    assertThat(sessionService.getMessages(uid, sid).get(1).followups()).isNull();
  }

  @Test
  void 다음_턴_맥락에는_후속_질문이_실리지_않는다() throws Exception {
    long uid = user();
    when(suggestionClient.suggest(any())).thenReturn(ITEMS);
    CountDownLatch streamed = stream("일정 2건이에요", "subagent", false);
    UUID sid = start(uid, "일정");
    assertThat(streamed.await(5, TimeUnit.SECONDS)).isTrue();
    awaitTrue(() -> payloads("home.chat.followups").size() == 1);

    var raw = contextService.load(uid, sid).raw();
    assertThat(raw).hasSize(2);
    assertThat(raw).noneMatch(m -> ITEMS.stream().anyMatch(i -> m.content().contains(i)));
  }

  @Test
  void 답이_길면_앞_4000자만_보낸다() throws Exception {
    long uid = user();
    when(suggestionClient.suggest(any())).thenReturn(List.of());
    CountDownLatch streamed = stream("가".repeat(5000), "subagent", false);
    start(uid, "긴 답");
    assertThat(streamed.await(5, TimeUnit.SECONDS)).isTrue();
    awaitTrue(
        () -> !org.mockito.Mockito.mockingDetails(suggestionClient).getInvocations().isEmpty());
    ArgumentCaptor<SuggestionRequest> c = ArgumentCaptor.forClass(SuggestionRequest.class);
    verify(suggestionClient).suggest(c.capture());
    assertThat(c.getValue().answer()).hasSize(4000);
    awaitSuggestionIdle();
    assertThat(payloads("home.chat.followups")).isEmpty(); // 빈 결과는 저장·발행 없음
  }
}
