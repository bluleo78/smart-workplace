package com.workplace.home.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.realtime.StreamingGenerationRegistry;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.exception.HomeChatUnavailableException;
import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.home.outbound.ChatMessages.ChatRequest;
import com.workplace.home.outbound.ChatMessages.ContextMessage;
import java.io.InterruptedIOException;
import java.time.Duration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.stereotype.Service;

/**
 * 홈 채팅 오케스트레이션 (B2, #593 편입): 세션 ensure → recentContext 구성 → 비서 해석 → USER 영속 → ai-agent SSE 구독 → 통합
 * /events 채널(home.chat.*)로 fanOut → done 시 ASSISTANT 영속.
 *
 * <p>권한·비서 해석은 스트림 시작 전 동기 실행 — 실패하면 GlobalExceptionHandler 가 일반 4xx 로 매핑한다(깨진 스트림 X). ASSISTANT
 * 영속은 펌프 스레드(aiChatStreamExecutor)에서 수행되므로 TenantContextTaskDecorator 가 GUC 를 전파한다.
 */
@Slf4j
@Service
public class HomeChatService {

  /** 생성 타임아웃 — CLI cold-start(최대 ~60s) + 실행 예산 여유. */
  private static final Duration TIMEOUT = Duration.ofSeconds(300);

  /**
   * compose 전용 CLI 예산 하한(#456). Global Chat 라우터는 여러 도메인 전문가(캘린더+메일 등)에 순차 위임하고 sync_mail(IMAP) 같은
   * 느린 도구를 거쳐, 공유 기본값 60s(AssistantDefaults.TIMEOUT_MS)를 종종 초과한다. compose 의 HTTP
   * read(AiAgentComposeClient 300s)·레지스트리 타임아웃(300s)이 이를 충분히 감싸므로 180s 로 상향한다.
   *
   * <p>공유 기본값을 올리지 않는 이유: 같은 값을 쓰는 mail/wiki 경로의 HTTP read 가 각각 90s/120s 라, 기본값을 180s 로 올리면 그 경로들이
   * CLI 완주 전에 잘린다. 따라서 compose 경로에서만 하한을 적용한다. 비서별 설정으로 더 큰 timeoutMs 가 지정되면 그 값을 존중한다(하한이므로).
   */
  private static final int COMPOSE_MIN_TIMEOUT_MS = 180_000;

  /** follow-up 맥락으로 전달할 직전 메시지 최대 개수(토큰 폭주 방지). */
  private static final int CONTEXT_LIMIT = 6;

  private final HomeSessionService sessionService;
  private final AiAgentChatClient chatClient;
  private final AiAgentProperties aiAgentProperties;
  private final ObjectMapper objectMapper;
  private final AssistantResolver assistantResolver;
  private final AsyncTaskExecutor executor;
  private final StreamingGenerationRegistry registry;
  private final SseRegistry sseRegistry;

  public HomeChatService(
      HomeSessionService sessionService,
      AiAgentChatClient chatClient,
      AiAgentProperties aiAgentProperties,
      ObjectMapper objectMapper,
      AssistantResolver assistantResolver,
      @Qualifier("aiChatStreamExecutor") AsyncTaskExecutor executor,
      StreamingGenerationRegistry registry,
      SseRegistry sseRegistry) {
    this.sessionService = sessionService;
    this.chatClient = chatClient;
    this.aiAgentProperties = aiAgentProperties;
    this.objectMapper = objectMapper;
    this.assistantResolver = assistantResolver;
    this.executor = executor;
    this.registry = registry;
    this.sseRegistry = sseRegistry;
  }

  /**
   * enabled 확인·세션 ensure·recentContext 구성·비서 해석·USER 영속을 동기 수행한 뒤, 펌프를 레지스트리에 등록하고 correlationId 를
   * 즉시 반환한다.
   *
   * <p>enabled 확인·세션 ensure·recentContext 구성·비서 해석·USER appendMessage 는 요청 스레드에서 동기 수행 → 실패 시
   * 4xx/5xx. ai-agent 호출은 비동기(전용 executor 스레드).
   *
   * @param callerId 요청 사용자 ID
   * @param sessionId null 이면 새 세션 생성
   * @param query 자연어 명령
   * @return 발급된 correlationId
   */
  public String startChat(long callerId, UUID sessionId, String query) {
    // 1) enabled 확인 — 비활성이면 시작 전 예외로 단락.
    if (!aiAgentProperties.enabled()) {
      throw new HomeChatUnavailableException("AI 채팅 기능이 현재 비활성화되어 있어요.");
    }

    // 2) 세션 ensure — sessionId null 이면 새 세션 생성.
    UUID sid = sessionId != null ? sessionId : sessionService.create(callerId).id();

    // 3) 현재 query 적재 전, 기존 대화에서 최근 N개를 텍스트 전용 맥락으로 구성.
    List<ContextMessage> recentContext = buildRecentContext(callerId, sid);

    // 4) 비서 해석 — 미설정이면 HomeAssistantNotConfiguredException(503) 로 단락.
    AssistantSpec spec = assistantResolver.resolve(callerId);

    // 5) USER 메시지 영속 — 요청 스레드(요청 tx) 에서 즉시 저장(tool_calls 는 USER 메시지에 없음).
    sessionService.appendMessage(callerId, sid, "USER", query, null, null);

    // userId: 요청 사용자 ID — ai-agent 의 MCP 도구가 assistantAgentId 아닌 실제 요청자 컨텍스트로
    // 드라이브·캘린더 등 사용자 귀속 리소스를 조회·수정하게 한다(refs #376).
    ChatRequest req =
        new ChatRequest(
            query,
            recentContext,
            spec.agentUserId(),
            callerId,
            spec.model(),
            spec.thinkingDepth(),
            spec.maxTurns(),
            // #456: compose 는 다중 도메인 위임으로 기본 60s 를 넘기 쉬워 하한(180s)을 적용.
            Math.max(spec.timeoutMs(), COMPOSE_MIN_TIMEOUT_MS));

    // 위임 라벨 + 도구 호출을 도착 순서로 누적(done 시 home_message.tool_calls 로 영속).
    // CopyOnWriteArrayList: 펌프 스레드에서 쓰고 done 핸들러에서 읽는 구조에 안전.
    List<Map<String, Object>> steps = new CopyOnWriteArrayList<>();

    return registry.start(
        callerId,
        executor,
        TIMEOUT,
        correlationId ->
            () -> {
              try {
                chatClient.composeStream(
                    req,
                    // delta: 즉시 fanOut(누적 버퍼는 더 이상 필요 없음 — done 은 ai-agent 가 준 fullText 사용).
                    delta ->
                        sseRegistry.fanOut(
                            Set.of(callerId),
                            "home.chat.delta",
                            Map.of("correlationId", correlationId, "text", delta)),
                    // done: ASSISTANT 영속 → home.chat.done fanOut.
                    (fullText, widgets) -> {
                      String wJson = serializeWidgets(widgets);
                      String toolCallsJson = serializeSteps(steps);
                      try {
                        sessionService.appendMessage(
                            callerId, sid, "ASSISTANT", fullText, wJson, toolCallsJson);
                      } catch (Exception e) {
                        log.error("ASSISTANT 메시지 영속 실패: {}", e.getMessage(), e);
                      }
                      Map<String, Object> donePayload = new HashMap<>();
                      donePayload.put("correlationId", correlationId);
                      donePayload.put("sessionId", sid.toString());
                      donePayload.put("widgets", widgets);
                      sseRegistry.fanOut(Set.of(callerId), "home.chat.done", donePayload);
                    },
                    // error(진짜 오류만 — 취소는 아래 catch 로 별도 처리): home.chat.error fanOut.
                    msg ->
                        sseRegistry.fanOut(
                            Set.of(callerId),
                            "home.chat.error",
                            Map.of("correlationId", correlationId, "message", msg)),
                    // progress: 위임 라벨 누적 + fanOut.
                    label -> {
                      steps.add(Map.of("kind", "delegation", "label", label));
                      sseRegistry.fanOut(
                          Set.of(callerId),
                          "home.chat.progress",
                          Map.of("correlationId", correlationId, "label", label));
                    },
                    // pending_action: 배열 자체가 아니라 { correlationId, actions } 봉투로 감싼다
                    // (공통 payload 봉투 규약 — correlationId 는 항상 최상위 필드).
                    node -> {
                      List<Object> actions = objectMapper.convertValue(node, List.class);
                      sseRegistry.fanOut(
                          Set.of(callerId),
                          "home.chat.pending_action",
                          Map.of("correlationId", correlationId, "actions", actions));
                    },
                    // tool: 표시 가능 도구는 영속 리스트에 추가(숨김 도구는 fanOut 만) + correlationId 병합 fanOut.
                    toolNode -> {
                      String phase = toolNode.path("phase").asText();
                      int seq = toolNode.path("seq").asInt();
                      if ("start".equals(phase)) {
                        String toolName = toolNode.path("toolName").asText();
                        if (isDisplayableTool(toolName)) {
                          Map<String, Object> step = new LinkedHashMap<>();
                          step.put("kind", "tool");
                          step.put("seq", seq);
                          step.put("toolName", toolName);
                          if (toolNode.has("args")) {
                            step.put(
                                "args", objectMapper.convertValue(toolNode.get("args"), Map.class));
                          }
                          step.put("status", "running");
                          steps.add(step);
                        }
                      } else {
                        boolean isError = toolNode.path("isError").asBoolean(false);
                        for (Map<String, Object> s : steps) {
                          if ("tool".equals(s.get("kind"))
                              && Integer.valueOf(seq).equals(s.get("seq"))
                              && "running".equals(s.get("status"))) {
                            s.put("status", isError ? "error" : "done");
                            break;
                          }
                        }
                      }
                      Map<String, Object> toolPayload =
                          new LinkedHashMap<>(objectMapper.convertValue(toolNode, Map.class));
                      toolPayload.put("correlationId", correlationId);
                      sseRegistry.fanOut(Set.of(callerId), "home.chat.tool", toolPayload);
                    });
              } catch (Exception e) {
                // composeStream 이 인터럽트로 인한 예외만 여기까지 던진다(그 외 오류는 위 onError
                // 콜백에서 이미 처리 후 정상 반환) — WikiAiService/DriveOverviewService 와 동일 패턴.
                boolean cancelled = isInterruption(e);
                Map<String, Object> payload =
                    cancelled
                        ? Map.of("correlationId", correlationId, "cancelled", true)
                        : Map.of("correlationId", correlationId, "message", e.getMessage());
                sseRegistry.fanOut(Set.of(callerId), "home.chat.error", payload);
              }
            });
  }

  /** 진행 중인 생성을 취소한다. 소유자 불일치/미존재면 레지스트리가 403/404 예외를 던진다. */
  public void cancelChat(String correlationId, long callerId) {
    registry.cancel(correlationId, callerId);
  }

  /**
   * 예외 체인(cause chain)을 순회해 InterruptedException/InterruptedIOException 이 있는지 검사한다
   * (WikiAiService.isInterruption 과 동일 — 취소로 인한 인터럽트가 블로킹 read 를 통과할 때 여러 겹으로 감싸질 수 있어 최상위 타입만 보면
   * 놓친다).
   */
  private static boolean isInterruption(Throwable e) {
    for (Throwable cur = e; cur != null; cur = cur.getCause()) {
      if (cur instanceof InterruptedException || cur instanceof InterruptedIOException) {
        return true;
      }
    }
    return false;
  }

  /**
   * 도구 이름이 화면에 표시되는 도구인지 판별한다. 프론트 aiToolLabels.ts 의 isDisplayableTool 과 동일 정책.
   *
   * <p>영속 대상(tool_calls)은 표시 가능 도구만 포함한다. show_* / propose_* 는 위젯·확인 카드로 이미 표현되고, respond_chat /
   * submit_response 는 내부 응답 배관으로 사용자에게 의미 없는 반복 정보다.
   */
  private boolean isDisplayableTool(String toolName) {
    // MCP 프리픽스 제거: mcp__workplace__update_status → update_status
    String n = toolName.replaceAll("^mcp__[^_]+__(.+)$", "$1");
    if (n.startsWith("show_") || n.startsWith("propose_")) return false;
    if (n.equals("respond_chat") || n.equals("submit_response")) return false;
    return true;
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

  /** 누적 steps → 영속용 JSON 문자열. 빈 리스트면 null(tool_calls 미저장 컨벤션과 동일). */
  private String serializeSteps(List<Map<String, Object>> steps) {
    if (steps == null || steps.isEmpty()) {
      return null;
    }
    try {
      return objectMapper.writeValueAsString(steps);
    } catch (JsonProcessingException e) {
      // 직렬화 실패는 응답 자체를 막을 만큼 치명적이지 않음 — tool_calls 없이 메시지만 보존.
      log.warn("tool_calls 직렬화 실패 — null 로 저장: {}", e.getMessage());
      return null;
    }
  }
}
