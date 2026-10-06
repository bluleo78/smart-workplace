package com.workplace.home.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.realtime.StreamingGenerationRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.dto.AiScreenContext;
import com.workplace.home.exception.HomeChatUnavailableException;
import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.home.outbound.ChatMessages.ChatRequest;
import java.time.Duration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.stereotype.Service;

/**
 * 홈 채팅 오케스트레이션 (B2, #593 편입): 세션 ensure → 맥락 스냅샷(누적 요약 + 원문, WP-232) 구성 → 비서 해석 → USER 영속 →
 * ai-agent SSE 구독 → 통합 /events 채널(home.chat.*)로 fanOut → done 시 ASSISTANT 영속.
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

  /** MCP 프리픽스(mcp__workplace__update_status → update_status). 도구 이름 판별 전에 벗겨낸다. */
  private static final Pattern MCP_PREFIX = Pattern.compile("^mcp__[^_]+__");

  /** WP-158: 위젯 도구 이름 → 위젯 타입(show_issue_list → issue_list). 웹 widgetTypeFromToolName 과 같은 규칙. */
  private static final Pattern SHOW_TOOL = Pattern.compile("show_([a-z_]+)$");

  /** WP-232: 동기 요약 중 진행 라벨(home.chat.progress). */
  static final String COMPACTING_LABEL = "이전 대화를 정리하는 중";

  private final HomeSessionService sessionService;
  private final HomeProposalService proposalService;
  private final HomeContextSummaryService contextService;

  /** WP-234: 첨부 검증·연결·세션 첨부 목록. */
  private final HomeAttachmentService attachmentService;

  private final AiAgentChatClient chatClient;
  private final AiAgentProperties aiAgentProperties;
  private final ObjectMapper objectMapper;
  private final AssistantResolver assistantResolver;
  private final AsyncTaskExecutor executor;
  private final StreamingGenerationRegistry registry;
  private final SseRegistry sseRegistry;

  public HomeChatService(
      HomeSessionService sessionService,
      HomeProposalService proposalService,
      HomeContextSummaryService contextService,
      HomeAttachmentService attachmentService,
      AiAgentChatClient chatClient,
      AiAgentProperties aiAgentProperties,
      ObjectMapper objectMapper,
      AssistantResolver assistantResolver,
      @Qualifier("aiChatStreamExecutor") AsyncTaskExecutor executor,
      StreamingGenerationRegistry registry,
      SseRegistry sseRegistry) {
    this.sessionService = sessionService;
    this.proposalService = proposalService;
    this.contextService = contextService;
    this.attachmentService = attachmentService;
    this.chatClient = chatClient;
    this.aiAgentProperties = aiAgentProperties;
    this.objectMapper = objectMapper;
    this.assistantResolver = assistantResolver;
    this.executor = executor;
    this.registry = registry;
    this.sseRegistry = sseRegistry;
  }

  /** 화면 컨텍스트 없는 호출(기존 호출부·테스트 호환) — null 컨텍스트, 첨부 없음으로 위임. */
  public String startChat(long callerId, UUID sessionId, String query) {
    return startChat(callerId, sessionId, query, null, List.of());
  }

  /** 첨부 없는 호출(기존 호출부·테스트 호환) — 첨부 없음으로 위임. */
  public String startChat(
      long callerId, UUID sessionId, String query, AiScreenContext screenContext) {
    return startChat(callerId, sessionId, query, screenContext, List.of());
  }

  /**
   * enabled 확인·세션 ensure·맥락 스냅샷 로드·비서 해석·USER 영속을 동기 수행한 뒤, 펌프를 레지스트리에 등록하고 correlationId 를 즉시
   * 반환한다.
   *
   * <p>enabled 확인·세션 ensure·맥락 스냅샷 로드·비서 해석·USER appendMessage 는 요청 스레드에서 동기 수행 → 실패 시 4xx/5xx.
   * ai-agent 호출은 비동기(전용 executor 스레드).
   *
   * @param callerId 요청 사용자 ID
   * @param sessionId null 이면 새 세션 생성
   * @param query 자연어 명령
   * @param screenContext 현재 화면 컨텍스트(WP-54, nullable) — 저장하지 않고 이번 요청에만 ai-agent 로 전달
   * @param fileIds 선업로드한 첨부 id(WP-234, null·빈 목록 허용) — USER 메시지와 같은 트랜잭션에서 연결·승격된다
   * @return 발급된 correlationId
   */
  public String startChat(
      long callerId,
      UUID sessionId,
      String query,
      AiScreenContext screenContext,
      List<Long> fileIds) {
    // 1) enabled 확인 — 비활성이면 시작 전 예외로 단락.
    if (!aiAgentProperties.enabled()) {
      throw new HomeChatUnavailableException("AI 채팅 기능이 현재 비활성화되어 있어요.");
    }

    // WP-234: 공백뿐인 본문은 ""로 정규화(저장·ai-agent 전달 공통 — ai-agent 는 빈 문자열만 기본 문구로 바꾼다).
    String text = query == null || query.isBlank() ? "" : query;

    // 1-1) WP-234: 첨부 입력 사전 검증 — 세션을 만들기 전에 걸러 잘못된 요청이 빈 새 세션을 남기지 않게 한다.
    attachmentService.precheck(callerId, text, fileIds);

    // 2) 세션 ensure — sessionId null 이면 새 세션 생성.
    UUID sid = sessionId != null ? sessionId : sessionService.create(callerId).id();

    // 3) 현재 query 적재 전, 세션 맥락 스냅샷(누적 요약 + 경계 이후 원문)을 확보(WP-232). 예산 초과 시 압축은 pump 에서.
    HomeContextSummaryService.ContextSnapshot snapshot = contextService.load(callerId, sid);

    // 4) 비서 해석 — 미설정이면 HomeAssistantNotConfiguredException(503) 로 단락.
    AssistantSpec spec = assistantResolver.resolve(callerId);

    // 5) USER 메시지 영속 + 첨부 연결(WP-234) — 한 트랜잭션(세션 잠금·상한·승격·추출 요청 포함).
    attachmentService.appendUserMessage(callerId, sid, text, fileIds);

    // 6) 이전 턴의 미처리 확인카드 만료(#843) — 웹은 새 질문 시 카드를 비우므로, 복원 시 되살아나지 않게 서버도 맞춘다.
    // 새 세션이면 만료할 카드가 없다.
    if (sessionId != null) {
      proposalService.expirePending(callerId, sid);
    }

    // #719: 요청 스레드의 active-tenant 를 미리 캡처해 pump 에서 ChatRequest 에 싣는다.
    Long tenantId = TenantContext.get();

    // 위임 라벨 + 도구 호출을 도착 순서로 누적(done 시 home_message.tool_calls 로 영속).
    // CopyOnWriteArrayList: 펌프 스레드에서 쓰고 done 핸들러에서 읽는 구조에 안전.
    List<Map<String, Object>> steps = new CopyOnWriteArrayList<>();
    // WP-158: 텍스트·도구 그룹·위젯의 도착 순서(done 시 home_message.content_blocks 로 영속 — 복원 시 같은 순서로 렌더).
    ChatBlockRecorder blocks = new ChatBlockRecorder();

    return registry.start(
        callerId,
        executor,
        TIMEOUT,
        correlationId ->
            () -> {
              try {
                // WP-232: 예산 초과 시 이 턴에서 동기 요약(진행 라벨 표시) — 요청 스레드를 막지 않도록 pump 에서 수행.
                HomeContextSummaryService.ContextSnapshot ctx =
                    contextService.fitToBudget(
                        callerId,
                        sid,
                        snapshot,
                        spec,
                        () ->
                            sseRegistry.fanOut(
                                Set.of(callerId),
                                "home.chat.progress",
                                Map.of("correlationId", correlationId, "label", COMPACTING_LABEL)));
                // userId: 요청 사용자 ID — ai-agent 의 MCP 도구가 assistantAgentId 아닌 실제 요청자 컨텍스트로
                // 드라이브·캘린더 등 사용자 귀속 리소스를 조회·수정하게 한다(refs #376).
                // tenantId: 요청 스레드에서 캡처한 active-tenant(JwtAuthenticationFilter 가 설정) — ai-agent 가
                // workplace-api 대리 호출 시 X-On-Behalf-Of-Tenant 로 되돌려 보내야, 요청자가 다중/무 멤버십일 때
                // AgentTenantResolver 가 fail-closed(테넌트 미해결→RLS GUC 미주입→권한 전부 거부) 되지 않는다(#719).
                ChatRequest req =
                    new ChatRequest(
                        text,
                        ctx.toContext(),
                        spec.agentUserId(),
                        callerId,
                        tenantId,
                        spec.model(),
                        spec.thinkingDepth(),
                        spec.maxTurns(),
                        // #456: compose 는 다중 도메인 위임으로 기본 60s 를 넘기 쉬워 하한(180s)을 적용.
                        Math.max(spec.timeoutMs(), COMPOSE_MIN_TIMEOUT_MS),
                        // WP-54: 화면 컨텍스트 1:1 전달(USER 메시지 영속에는 포함하지 않는다).
                        screenContext,
                        ctx.summary());
                chatClient.composeStream(
                    req,
                    // delta: 즉시 fanOut(누적 버퍼는 더 이상 필요 없음 — done 은 ai-agent 가 준 fullText 사용).
                    delta -> {
                      blocks.onDelta(delta);
                      sseRegistry.fanOut(
                          Set.of(callerId),
                          "home.chat.delta",
                          Map.of("correlationId", correlationId, "text", delta));
                    },
                    // done: ASSISTANT 영속 → home.chat.done fanOut.
                    (fullText, widgets) -> {
                      String wJson = serializeWidgets(widgets);
                      String toolCallsJson = serializeList(steps, "tool_calls");
                      String blocksJson = serializeList(blocks.finish(fullText), "content_blocks");
                      try {
                        sessionService.appendMessage(
                            callerId, sid, "ASSISTANT", fullText, wJson, toolCallsJson, blocksJson);
                      } catch (Exception e) {
                        log.error("ASSISTANT 메시지 영속 실패: {}", e.getMessage(), e);
                      }
                      Map<String, Object> donePayload = new HashMap<>();
                      donePayload.put("correlationId", correlationId);
                      donePayload.put("sessionId", sid.toString());
                      donePayload.put("widgets", widgets);
                      sseRegistry.fanOut(Set.of(callerId), "home.chat.done", donePayload);
                      // WP-232: 맥락이 trigger 를 넘었으면 다음 턴을 위해 비동기 요약 예약(예외 없음, 응답 지연 없음).
                      contextService.scheduleIfNeeded(callerId, sid);
                    },
                    // error(진짜 오류만 — 취소는 아래 catch 로 별도 처리): home.chat.error fanOut.
                    msg ->
                        sseRegistry.fanOut(
                            Set.of(callerId),
                            "home.chat.error",
                            Map.of("correlationId", correlationId, "message", msg)),
                    // progress: 위임 라벨 누적 + fanOut.
                    label -> {
                      blocks.onStep(steps.size());
                      steps.add(Map.of("kind", "delegation", "label", label));
                      sseRegistry.fanOut(
                          Set.of(callerId),
                          "home.chat.progress",
                          Map.of("correlationId", correlationId, "label", label));
                    },
                    // pending_action: 제안을 먼저 영속(#843)해 id 를 붙인 뒤 { correlationId, sessionId,
                    // actions }
                    // 봉투로 fanOut(공통 봉투 규약 — correlationId 는 항상 최상위 필드). sessionId 를 함께 싣는 이유:
                    // 새 세션이면 웹은 done 에서야 sessionId 를 알게 되는데 pending_action 은 done 보다 먼저 온다.
                    node ->
                        sseRegistry.fanOut(
                            Set.of(callerId),
                            "home.chat.pending_action",
                            Map.of(
                                "correlationId",
                                correlationId,
                                "sessionId",
                                sid.toString(),
                                "actions",
                                proposalService.record(callerId, sid, node))),
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
                          blocks.onStep(steps.size());
                          steps.add(step);
                        } else {
                          Map<String, Object> widget = widgetOf(toolName, toolNode.path("args"));
                          if (widget != null) blocks.onWidget(widget);
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
                // composeStream·fitToBudget(동기 요약) 은 인터럽트로 인한 예외만 여기까지 던진다(그 외 오류는
                // onError 콜백·요약 폴백에서 이미 처리) — WikiAiService/DriveOverviewService 와 동일 패턴.
                // 인터럽트 플래그도 본다 — fitToBudget 은 isUserCancel(플래그 포함)로 취소를 판별해 cause 체인에 인터럽트가
                // 없는 예외를 그대로 던질 수 있다. 체인만 보면 취소된 턴이 cancelled 대신 오류 메시지로 끝난다(WP-232).
                boolean cancelled =
                    HomeInterruptions.isInterruption(e) || Thread.currentThread().isInterrupted();
                Map<String, Object> payload =
                    cancelled
                        ? Map.of("correlationId", correlationId, "cancelled", true)
                        : Map.of(
                            "correlationId",
                            correlationId,
                            "message",
                            // 메시지 없는 예외도 있어 Map.of 의 null NPE 를 막는다.
                            Objects.requireNonNullElse(e.getMessage(), "채팅 처리 중 오류가 발생했습니다"));
                sseRegistry.fanOut(Set.of(callerId), "home.chat.error", payload);
              }
            });
  }

  /** 진행 중인 생성을 취소한다. 소유자 불일치/미존재면 레지스트리가 403/404 예외를 던진다. */
  public void cancelChat(String correlationId, long callerId) {
    registry.cancel(correlationId, callerId);
  }

  /**
   * 도구 이름이 화면에 표시되는 도구인지 판별한다. 프론트 aiToolLabels.ts 의 isDisplayableTool 과 동일 정책.
   *
   * <p>영속 대상(tool_calls)은 표시 가능 도구만 포함한다. show_* / propose_* 는 위젯·확인 카드로 이미 표현되고, respond_chat /
   * submit_response 는 내부 응답 배관으로 사용자에게 의미 없는 반복 정보다.
   */
  private boolean isDisplayableTool(String toolName) {
    String n = stripMcpPrefix(toolName);
    if (n.startsWith("show_") || n.startsWith("propose_")) return false;
    if (n.equals("respond_chat") || n.equals("submit_response")) return false;
    return true;
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

  /**
   * WP-158: show_* 도구 시작 이벤트 → 웹 WidgetSpec 과 같은 {type, params, layout?}. show_* 가 아니면 null.
   *
   * <p>웹 useChatSession 이 라이브 위젯 블록을 만드는 규칙과 같다 — 복원 시 reconcileBlocks 가 done 위젯 목록과 (type+params)
   * 로 대조하므로 형태가 일치해야 한다.
   */
  private Map<String, Object> widgetOf(String toolName, JsonNode args) {
    Matcher m = SHOW_TOOL.matcher(stripMcpPrefix(toolName));
    if (!m.find()) return null;
    Map<String, Object> w = new LinkedHashMap<>();
    w.put("type", m.group(1));
    JsonNode params = args.path("params");
    w.put("params", params.isObject() ? objectMapper.convertValue(params, Map.class) : Map.of());
    if (args.path("layout").isObject()) {
      w.put("layout", objectMapper.convertValue(args.get("layout"), Map.class));
    }
    return w;
  }

  private static String stripMcpPrefix(String toolName) {
    return MCP_PREFIX.matcher(toolName).replaceFirst("");
  }

  /**
   * 누적 목록(tool_calls·content_blocks) → 영속용 JSON 문자열. null/빈 목록이면 null(미저장 컨벤션 — 웹은 폴백 렌더).
   *
   * @param column 실패 로그용 컬럼 이름
   */
  private String serializeList(List<?> list, String column) {
    if (list == null || list.isEmpty()) {
      return null;
    }
    try {
      return objectMapper.writeValueAsString(list);
    } catch (JsonProcessingException e) {
      // 직렬화 실패는 응답 자체를 막을 만큼 치명적이지 않음 — 해당 컬럼 없이 메시지만 보존.
      log.warn("{} 직렬화 실패 — null 로 저장: {}", column, e.getMessage());
      return null;
    }
  }
}
