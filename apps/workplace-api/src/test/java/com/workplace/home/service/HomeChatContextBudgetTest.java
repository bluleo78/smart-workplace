package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.global.util.TokenEstimates;
import com.workplace.home.exception.HomeContextSummaryException;
import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.home.outbound.AiAgentContextSummaryClient;
import com.workplace.home.outbound.ChatMessages.ChatRequest;
import com.workplace.home.outbound.ChatMessages.ContextMessage;
import com.workplace.home.outbound.ChatMessages.ContextSummaryRequest;
import com.workplace.home.outbound.ChatMessages.ContextSummaryResult;
import com.workplace.home.repository.HomeSessionRepository.SummaryState;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.BooleanSupplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 메인 AI 채팅 토큰 예산 + 누적 요약 통합 테스트(WP-232). 예산을 400 으로 낮춰(trigger 300 / target 200 / 메시지 상한 100)
 * 동기·비동기 요약 경로를 검증한다. 펌프·요약 워커가 별도 스레드에서 커밋하므로 @Transactional 을 쓰지 않는다(HomeChatServiceTest 와 동일 이유
 * — TenantScopedRunner mock 도 같은 flake 차단 목적).
 */
@TestPropertySource(
    properties = {
      "workplace.ai-agent.enabled=true",
      "workplace.home.chat.context-token-budget=400"
    })
class HomeChatContextBudgetTest extends IntegrationTestBase {

  @Autowired HomeChatService chatService;
  @Autowired HomeSessionService sessionService;
  @Autowired DSLContext dsl;
  @MockitoBean AiAgentChatClient chatClient;
  @MockitoBean AiAgentContextSummaryClient summaryClient;
  @MockitoBean AssistantResolver assistantResolver;
  @MockitoBean SseRegistry sseRegistry;
  @MockitoBean TenantScopedRunner tenantScopedRunner;

  private final List<Long> users = new ArrayList<>();

  @AfterEach
  void cleanup() {
    if (!users.isEmpty()) dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    users.clear();
  }

  private long user() {
    String n = "ctxbud" + System.nanoTime();
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
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
    return id;
  }

  /** 접두 라벨 + 한글 채움으로 비용을 맞춘 본문(label 은 한글 2자 + 숫자). */
  private static String body(String label, int koChars) {
    return label + "가".repeat(Math.max(0, koChars - label.length()));
  }

  /** composeStream 이 즉시 done 하도록 스텁하고 latch 반환. */
  private CountDownLatch stubDone(String reply) throws Exception {
    CountDownLatch latch = new CountDownLatch(1);
    doAnswer(
            inv -> {
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDone.accept(reply, null);
              latch.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());
    return latch;
  }

  private ChatRequest sentRequest() throws Exception {
    ArgumentCaptor<ChatRequest> c = ArgumentCaptor.forClass(ChatRequest.class);
    verify(chatClient).composeStream(c.capture(), any(), any(), any(), any(), any(), any());
    return c.getValue();
  }

  private static void await(BooleanSupplier cond) throws InterruptedException {
    long deadline = System.currentTimeMillis() + 5000;
    while (!cond.getAsBoolean()) {
      if (System.currentTimeMillis() > deadline) throw new AssertionError("timeout");
      Thread.sleep(50);
    }
  }

  @Test
  void 예산_이내면_요약없이_원문_전체를_보낸다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    sessionService.appendMessage(uid, sid, "USER", "질문1", null, null, null);
    sessionService.appendMessage(uid, sid, "ASSISTANT", "답1", null, null, null);
    CountDownLatch latch = stubDone("네");

    chatService.startChat(uid, sid, "다음");
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    ChatRequest req = sentRequest();
    assertThat(req.contextSummary()).isNull();
    assertThat(req.recentContext()).extracting("content").containsExactly("질문1", "답1");
    verify(summaryClient, never()).summarize(any());
  }

  @Test
  void 하드상한_초과면_compose_전에_동기요약하고_경계이후만_원문으로_보낸다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    // 비용 50 × 10건 = 500 > 400.
    for (int i = 1; i <= 5; i++) {
      sessionService.appendMessage(uid, sid, "USER", body("질문" + i, 46), null, null, null);
      sessionService.appendMessage(uid, sid, "ASSISTANT", body("답변" + i, 46), null, null, null);
    }
    when(summaryClient.summarize(any())).thenReturn(new ContextSummaryResult("요약본"));
    CountDownLatch latch = stubDone("네");

    chatService.startChat(uid, sid, "처음 질문이 뭐였지?");
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    var order = inOrder(summaryClient, chatClient);
    ArgumentCaptor<ContextSummaryRequest> sc = ArgumentCaptor.forClass(ContextSummaryRequest.class);
    order.verify(summaryClient).summarize(sc.capture());
    order.verify(chatClient).composeStream(any(), any(), any(), any(), any(), any(), any());

    // target 200 → 최신 4건(200) 유지, 앞 6건 요약.
    assertThat(sc.getValue().previousSummary()).isNull();
    assertThat(sc.getValue().messages())
        .extracting(ContextMessage::content)
        .first()
        .asString()
        .startsWith("질문1");
    assertThat(sc.getValue().messages()).hasSize(6);

    ChatRequest req = sentRequest();
    assertThat(req.contextSummary()).isEqualTo("요약본");
    assertThat(req.recentContext()).hasSize(4);
    assertThat(req.recentContext().get(3).content()).startsWith("답변5");

    SummaryState saved = sessionService.getContextSummary(uid, sid);
    assertThat(saved.summary()).isEqualTo("요약본");
    long lastFoldedId = sessionService.getMessages(uid, sid).get(5).id(); // 6번째 메시지(답변3)
    assertThat(saved.uptoMessageId()).isEqualTo(lastFoldedId);

    // 동기 요약 동안 진행 라벨이 나간다.
    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(sseRegistry, org.mockito.Mockito.atLeastOnce())
        .fanOut(any(), eq("home.chat.progress"), payload.capture());
    assertThat(payload.getAllValues())
        .anySatisfy(p -> assertThat(((Map<?, ?>) p).get("label")).isEqualTo("이전 대화를 정리하는 중"));
  }

  @Test
  void 동기요약이_실패하면_오래된_원문을_버리고_채팅은_진행된다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    for (int i = 1; i <= 5; i++) {
      sessionService.appendMessage(uid, sid, "USER", body("질문" + i, 46), null, null, null);
      sessionService.appendMessage(uid, sid, "ASSISTANT", body("답변" + i, 46), null, null, null);
    }
    when(summaryClient.summarize(any())).thenThrow(new HomeContextSummaryException("boom", null));
    CountDownLatch latch = stubDone("네");

    chatService.startChat(uid, sid, "다음");
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    ChatRequest req = sentRequest();
    assertThat(req.contextSummary()).isNull();
    // 예산 400 → 최신 8건(400) 유지, 가장 오래된 2건 버림.
    assertThat(req.recentContext()).hasSize(8);
    assertThat(req.recentContext().get(0).content()).startsWith("질문2");
    assertThat(sessionService.getContextSummary(uid, sid)).isEqualTo(new SummaryState(null, null));
  }

  @Test
  void 턴종료후_trigger_초과면_비동기로_요약하고_다음턴에_반영한다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    // 비용 50 × 6건 = 300(= trigger, 초과 아님). 이번 턴 Q/A 가 더해지면 초과.
    for (int i = 1; i <= 3; i++) {
      sessionService.appendMessage(uid, sid, "USER", body("질문" + i, 46), null, null, null);
      sessionService.appendMessage(uid, sid, "ASSISTANT", body("답변" + i, 46), null, null, null);
    }
    when(summaryClient.summarize(any())).thenReturn(new ContextSummaryResult("비동기 요약"));
    CountDownLatch first = stubDone(body("답변4", 46));

    chatService.startChat(uid, sid, body("질문4", 46));
    assertThat(first.await(5, TimeUnit.SECONDS)).isTrue();
    // 이번 턴은 예산 이내였으므로 동기 요약 없이 원문만.
    assertThat(sentRequest().contextSummary()).isNull();

    await(() -> sessionService.getContextSummary(uid, sid).summary() != null);
    SummaryState saved = sessionService.getContextSummary(uid, sid);
    assertThat(saved.summary()).isEqualTo("비동기 요약");

    reset(chatClient);
    CountDownLatch second = stubDone("네");
    chatService.startChat(uid, sid, "처음 질문 뭐였지?");
    assertThat(second.await(5, TimeUnit.SECONDS)).isTrue();
    ChatRequest req = sentRequest();
    assertThat(req.contextSummary()).isEqualTo("비동기 요약");
    // 경계(uptoId) 이후 메시지만 원문 — 8건(400) 중 target 200 → 최신 4건.
    assertThat(req.recentContext()).hasSize(4);
    assertThat(req.recentContext().get(0).content()).startsWith("질문3");
  }

  @Test
  void 요약_직후_턴은_비동기요약을_다시_예약하지_않는다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    for (int i = 1; i <= 5; i++) {
      sessionService.appendMessage(uid, sid, "USER", body("질문" + i, 46), null, null, null);
      sessionService.appendMessage(uid, sid, "ASSISTANT", body("답변" + i, 46), null, null, null);
    }
    when(summaryClient.summarize(any())).thenReturn(new ContextSummaryResult("요약본"));
    CountDownLatch latch = stubDone("네");

    chatService.startChat(uid, sid, "다음");
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();
    // 동기 요약 1회 후, 압축된 원문(200)+요약+이번 Q/A 는 trigger(300) 미만 → 추가 요약 없음.
    Thread.sleep(500); // 비동기 예약이 잘못 일어났다면 실행될 시간
    verify(summaryClient, org.mockito.Mockito.times(1)).summarize(any());
  }

  @Test
  void 꼬리불변식_마지막_AI답과_그뒤_승인결과는_작은_예산에서도_원문으로_남는다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    for (int i = 1; i <= 3; i++) {
      sessionService.appendMessage(uid, sid, "USER", body("질문" + i, 46), null, null, null);
      sessionService.appendMessage(uid, sid, "ASSISTANT", body("답변" + i, 46), null, null, null);
    }
    sessionService.appendMessage(uid, sid, "ASSISTANT", body("마지막답", 96), null, null, null);
    sessionService.appendActionResult(uid, sid, "ACTION_DONE", body("승인완료", 46));
    sessionService.appendActionResult(uid, sid, "ACTION_FAILED", body("승인실패", 46));
    when(summaryClient.summarize(any())).thenReturn(new ContextSummaryResult("요약본"));
    CountDownLatch latch = stubDone("네");

    chatService.startChat(uid, sid, "잘 됐어?");
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    // 총 300 + 100 + 100 = 500 > 400 → 동기 요약. 꼬리(200)는 target(200) 을 채워 앞 6건 전부 요약.
    ChatRequest req = sentRequest();
    assertThat(req.recentContext())
        .extracting(ContextMessage::role)
        .containsExactly("ASSISTANT", "ACTION_DONE", "ACTION_FAILED");
    assertThat(req.recentContext().get(0).content()).startsWith("마지막답");
  }

  @Test
  void 메시지별_상한을_넘는_본문은_잘려서_실린다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    sessionService.appendMessage(uid, sid, "USER", "보고서 붙여넣기", null, null, null);
    sessionService.appendMessage(uid, sid, "ASSISTANT", "가".repeat(300), null, null, null);
    CountDownLatch latch = stubDone("네");

    chatService.startChat(uid, sid, "요약해줘");
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    String assistant = sentRequest().recentContext().get(1).content();
    assertThat(assistant).endsWith(TokenEstimates.TRUNCATION_MARK);
    assertThat(TokenEstimates.estimate(assistant)).isLessThanOrEqualTo(100);
    verify(summaryClient, never()).summarize(any());
  }
}
