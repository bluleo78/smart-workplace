package com.workplace.home.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.exception.HomeComposeUnavailableException;
import com.workplace.home.outbound.AiAgentComposeClient;
import com.workplace.home.outbound.ComposeMessages.ComposeRequest;
import com.workplace.home.outbound.ComposeMessages.ContextMessage;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Future;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 홈 컴포즈 오케스트레이션 (B2): 세션 ensure → recentContext 구성 → 비서 해석 → USER 영속 → ai-agent SSE 구독 → delta 패스스루
 * → done 시 ASSISTANT 영속.
 *
 * <p>권한·비서 해석은 스트림 시작 전 동기 실행 — 실패하면 GlobalExceptionHandler 가 일반 4xx 로 매핑한다(깨진 스트림 X). ASSISTANT
 * 영속은 펌프 스레드(aiComposeStreamExecutor)에서 수행되므로 TenantContextTaskDecorator 가 GUC 를 전파한다.
 */
@Slf4j
@Service
public class HomeComposeService {

  /** SSE 타임아웃 — CLI cold-start(최대 ~60s) + 실행 예산 여유. */
  private static final long TIMEOUT_MS = 300_000L;

  /** follow-up 맥락으로 전달할 직전 메시지 최대 개수(토큰 폭주 방지). */
  private static final int CONTEXT_LIMIT = 6;

  private final HomeSessionService sessionService;
  private final AiAgentComposeClient composeClient;
  private final AiAgentProperties aiAgentProperties;
  private final ObjectMapper objectMapper;
  private final AssistantResolver assistantResolver;
  private final AsyncTaskExecutor executor;

  public HomeComposeService(
      HomeSessionService sessionService,
      AiAgentComposeClient composeClient,
      AiAgentProperties aiAgentProperties,
      ObjectMapper objectMapper,
      AssistantResolver assistantResolver,
      @Qualifier("aiComposeStreamExecutor") AsyncTaskExecutor executor) {
    this.sessionService = sessionService;
    this.composeClient = composeClient;
    this.aiAgentProperties = aiAgentProperties;
    this.objectMapper = objectMapper;
    this.assistantResolver = assistantResolver;
    this.executor = executor;
  }

  /**
   * SSE 스트리밍 compose — ai-agent delta 를 emitter 로 패스스루하고, done 시 ASSISTANT 메시지를 영속한다.
   *
   * <p>enabled 확인·세션 ensure·recentContext 구성·비서 해석·USER appendMessage 는 요청 스레드에서 동기 수행 → 실패 시 스트림 전
   * 4xx/5xx 로 단락. ai-agent SSE 소비(펌프)는 전용 executor 스레드에서 비동기 수행.
   *
   * @param callerId 요청 사용자 ID
   * @param sessionId null 이면 새 세션 생성
   * @param query 자연어 명령
   * @return SSE emitter
   */
  public SseEmitter composeStream(long callerId, UUID sessionId, String query) {
    // 1) enabled 확인 — 비활성이면 스트림 전 예외로 단락.
    if (!aiAgentProperties.enabled()) {
      throw new HomeComposeUnavailableException("AI 구성 기능이 현재 비활성화되어 있어요.");
    }

    // 2) 세션 ensure — sessionId null 이면 새 세션 생성.
    UUID sid = sessionId != null ? sessionId : sessionService.create(callerId).id();

    // 3) 현재 query 적재 전, 기존 대화에서 최근 N개를 텍스트 전용 맥락으로 구성.
    List<ContextMessage> recentContext = buildRecentContext(callerId, sid);

    // 4) 비서 해석 — 미설정이면 HomeAssistantNotConfiguredException(503) 로 단락.
    AssistantSpec spec = assistantResolver.resolve(callerId);

    // 5) USER 메시지 영속 — 요청 스레드(요청 tx) 에서 즉시 저장.
    sessionService.appendMessage(callerId, sid, "USER", query, null);

    // userId: 요청 사용자 ID — ai-agent 의 MCP 도구가 assistantAgentId 아닌 실제 요청자 컨텍스트로
    // 드라이브·캘린더 등 사용자 귀속 리소스를 조회·수정하게 한다(refs #376).
    ComposeRequest req =
        new ComposeRequest(
            query,
            recentContext,
            spec.agentUserId(),
            callerId,
            spec.model(),
            spec.thinkingDepth(),
            spec.maxTurns(),
            spec.timeoutMs());

    // 6) emitter 생성 및 펌프 스레드 제출.
    SseEmitter emitter = newEmitter();
    StringBuilder fullBuffer = new StringBuilder();

    Future<?> task =
        executor.submit(
            () -> {
              composeClient.composeStream(
                  req,
                  // delta: 버퍼에 누적 + 즉시 패스스루
                  delta -> {
                    fullBuffer.append(delta);
                    trySend(emitter, "delta", Map.of("text", delta));
                  },
                  // done: ASSISTANT 영속 → done 이벤트 발행 → emitter 완료
                  (fullText, widgets) -> {
                    String wJson = serializeWidgets(widgets);
                    try {
                      sessionService.appendMessage(callerId, sid, "ASSISTANT", fullText, wJson);
                    } catch (Exception e) {
                      log.error("ASSISTANT 메시지 영속 실패: {}", e.getMessage(), e);
                    }
                    trySend(emitter, "done", Map.of("sessionId", sid.toString()));
                    emitter.complete();
                  },
                  // error: SSE error 이벤트 발행 → emitter 완료
                  msg -> {
                    trySend(emitter, "error", Map.of("message", msg));
                    emitter.complete();
                  },
                  // #333 M2: progress — 위임 라벨을 클라이언트에 패스스루
                  label -> trySend(emitter, "progress", Map.of("label", label)),
                  // #333 M2: pending_action — 확인 카드 제안 객체를 raw JSON 으로 패스스루
                  node -> trySend(emitter, "pending_action", node));
            });

    // 7) emitter 생명주기 → 펌프 취소(자원 누수 방지).
    emitter.onTimeout(() -> task.cancel(true));
    emitter.onError(e -> task.cancel(true));
    emitter.onCompletion(() -> task.cancel(false));

    return emitter;
  }

  /** SseEmitter 생성 — 테스트에서 스파이/목으로 대체할 수 있도록 분리. */
  protected SseEmitter newEmitter() {
    return new SseEmitter(TIMEOUT_MS);
  }

  /** 세션의 최근 메시지를 텍스트 전용(role+content)으로, 마지막 CONTEXT_LIMIT 개만. */
  private List<ContextMessage> buildRecentContext(long callerId, UUID sessionId) {
    List<HomeMessageResponse> all = sessionService.getMessages(callerId, sessionId);
    int from = Math.max(0, all.size() - CONTEXT_LIMIT);
    return all.subList(from, all.size()).stream()
        .map(m -> new ContextMessage(m.role(), m.content()))
        .toList();
  }

  /** 위젯 JsonNode → 영속용 JSON 문자열. null/누락이면 null(USER 메시지 컨벤션과 동일). */
  private String serializeWidgets(JsonNode widgets) {
    if (widgets == null || widgets.isNull()) {
      return null;
    }
    try {
      return objectMapper.writeValueAsString(widgets);
    } catch (JsonProcessingException e) {
      // 위젯 직렬화 실패는 응답 자체를 막을 만큼 치명적이지 않음 — 위젯 없이 메시지만 보존.
      return null;
    }
  }

  /** SseEmitter 에 이벤트를 안전하게 전송한다. IOException(연결 끊김)은 로그 없이 무시. 테스트에서 오버라이드 가능. */
  protected void trySend(SseEmitter emitter, String eventName, Object data) {
    try {
      emitter.send(SseEmitter.event().name(eventName).data(data));
    } catch (IOException ignored) {
      // 클라이언트 연결 끊김 — 이미 닫힌 소켓에 쓰는 실패는 무시.
    }
  }
}
