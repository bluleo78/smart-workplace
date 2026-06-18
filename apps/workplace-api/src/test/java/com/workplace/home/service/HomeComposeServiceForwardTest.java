package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.home.outbound.AiAgentComposeClient;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * HomeComposeService 의 progress·pending_action 콜백 → SSE 이벤트 포워드 검증.
 *
 * <p>trySend() 를 오버라이드한 서브클래스 인스턴스로 (eventName, data) 쌍을 캡처한다. newEmitter() 오버라이드로 emitter 교체.
 */
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class HomeComposeServiceForwardTest extends IntegrationTestBase {

  @MockitoBean AiAgentComposeClient composeClient;
  @MockitoBean AssistantResolver assistantResolver;
  @Autowired HomeSessionService sessionService;
  @Autowired AiAgentProperties aiAgentProperties;
  @Autowired ObjectMapper objectMapper;

  @Autowired
  @org.springframework.beans.factory.annotation.Qualifier("homeComposeStreamExecutor")
  AsyncTaskExecutor homeComposeStreamExecutor;

  /** 전송된 (eventName, data) 쌍을 모으는 기록 컨테이너. */
  static final class SentEvent {
    final String name;
    final Object data;

    SentEvent(String name, Object data) {
      this.name = name;
      this.data = data;
    }
  }

  /** trySend() 를 가로채 전송 이벤트를 캡처하는 서비스 서브클래스. newEmitter() 도 기본 SseEmitter 로 고정(타임아웃 없음). */
  private HomeComposeService serviceCapturing(List<SentEvent> captured) {
    return new HomeComposeService(
        sessionService,
        composeClient,
        aiAgentProperties,
        objectMapper,
        assistantResolver,
        homeComposeStreamExecutor) {
      @Override
      protected SseEmitter newEmitter() {
        // 타임아웃 없는 emitter — 테스트 중 만료 방지.
        return new SseEmitter(0L);
      }

      @Override
      protected void trySend(SseEmitter emitter, String eventName, Object data) {
        // 실제 전송 대신 캡처만 수행한다.
        captured.add(new SentEvent(eventName, data));
      }
    };
  }

  private void stubAssistant() {
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
  }

  /**
   * onProgress 콜백이 호출되면 event: progress 가 SSE 로 발행되는지 검증.
   *
   * <p>composeClient.composeStream 을 가로채 onProgress("캘린더 전문가에게 위임 중") → onDone 순으로 즉시 호출한다.
   * CountDownLatch 로 펌프 완료를 기다린 뒤, 캡처된 이벤트 목록에서 progress + 라벨을 단언한다.
   */
  @Test
  void progress_콜백을_받으면_SSE_progress_이벤트를_발행한다() throws Exception {
    long uid = createAgentUser("fwd-prog");
    stubAssistant();

    CountDownLatch latch = new CountDownLatch(1);
    doAnswer(
            inv -> {
              Consumer<String> onProgress = inv.getArgument(4);
              onProgress.accept("캘린더 전문가에게 위임 중");
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDone.accept("처리했어요", null);
              latch.countDown();
              return null;
            })
        .when(composeClient)
        .composeStream(any(), any(), any(), any(), any(), any());

    List<SentEvent> captured = new ArrayList<>();
    serviceCapturing(captured).composeStream(uid, null, "다음주 회의 잡아줘");

    // 펌프 완료 대기(최대 5초).
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    // progress 이벤트가 발행되고 라벨이 포함됐는지 검증.
    List<SentEvent> progressEvents =
        captured.stream().filter(e -> "progress".equals(e.name)).toList();
    assertThat(progressEvents).isNotEmpty();
    // data 는 Map.of("label", label) — label 값 추출 검증.
    assertThat(progressEvents.get(0).data.toString()).contains("캘린더 전문가에게 위임 중");
  }

  /**
   * onPendingAction 콜백이 호출되면 event: pending_action 이 SSE 로 발행되는지 검증.
   *
   * <p>composeClient.composeStream 을 가로채 onPendingAction(proposal) → onDone 순으로 즉시 호출한다. 캡처된 이벤트에서
   * pending_action + actionType 값을 단언한다.
   */
  @Test
  void pending_action_콜백을_받으면_SSE_pending_action_이벤트를_발행한다() throws Exception {
    long uid = createAgentUser("fwd-pa");
    stubAssistant();

    JsonNode proposal =
        objectMapper.readTree(
            "{\"actionType\":\"calendar.create_event\",\"summary\":\"내일 10시\",\"params\":{}}");
    CountDownLatch latch = new CountDownLatch(1);
    doAnswer(
            inv -> {
              Consumer<JsonNode> onPending = inv.getArgument(5);
              onPending.accept(proposal);
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDone.accept("제안했어요", null);
              latch.countDown();
              return null;
            })
        .when(composeClient)
        .composeStream(any(), any(), any(), any(), any(), any());

    List<SentEvent> captured = new ArrayList<>();
    serviceCapturing(captured).composeStream(uid, null, "내일 10시 회의 잡아줘");

    // 펌프 완료 대기(최대 5초).
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    // pending_action 이벤트가 발행되고 actionType 이 포함됐는지 검증.
    List<SentEvent> pendingEvents =
        captured.stream().filter(e -> "pending_action".equals(e.name)).toList();
    assertThat(pendingEvents).isNotEmpty();
    // data 는 raw JsonNode — actionType 값 검증.
    assertThat(pendingEvents.get(0).data.toString()).contains("calendar.create_event");
  }
}
