package com.workplace.home.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.exception.StreamingGenerationRejectedException;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.realtime.StreamingGenerationRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.dto.AiScreenContext;
import com.workplace.home.dto.HomeChatActiveResponse;
import com.workplace.home.dto.HomeChatStartedResponse;
import com.workplace.home.exception.HomeChatConcurrencyLimitException;
import com.workplace.home.exception.HomeChatSessionBusyException;
import com.workplace.home.exception.HomeChatUnavailableException;
import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.home.outbound.ChatMessages.ChatAttachment;
import com.workplace.home.outbound.ChatMessages.ChatRequest;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.stereotype.Service;

/**
 * 홈 채팅 오케스트레이션 (B2, #593 편입): 세션 ensure → 맥락 스냅샷(누적 요약 + 원문, WP-232) 구성 → 비서 해석 → USER 영속 →
 * ai-agent SSE 구독 → 통합 /events 채널(home.chat.*)로 fanOut → done 시 ASSISTANT 영속. WP-190: 슬롯
 * 예약(409/429) 뒤 동기 단계를 수행하고, 종결은 HomeChatTurn 이 영속→반납→이벤트 순으로 처리한다.
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

  /**
   * compose 전용 턴 한도 하한. maxTurns 는 질문 1건 처리 중 라우터가 도구·위임을 반복하는 횟수 상한인데, 공유 기본값
   * 8(AssistantDefaults.MAX_TURNS)로는 "어제~오늘 완료된 이슈를 에픽 중심으로" 같은 조회도 끝나기 전에 끊겨 "오류로 중단됨"이 됐다(운영 실측).
   * 무한 루프 방지용 안전장치로만 두도록 넉넉히 50 으로 올린다 — 실제 실행 시간은 위 timeout 하한(180s)이 묶는다.
   *
   * <p>공유 기본값을 올리지 않는 이유는 timeout 과 같다(다른 단발 AI 경로에 영향을 주지 않기 위해 compose 에만 하한 적용).
   */
  private static final int COMPOSE_MIN_MAX_TURNS = 50;

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
  private final HomeChatProperties chatProperties;

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
      SseRegistry sseRegistry,
      HomeChatProperties chatProperties) {
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
    this.chatProperties = chatProperties;
  }

  /** 홈 채팅 레지스트리 scope 접두 — 대화(sessionId) 단위로 동시 생성을 추적한다(WP-190). */
  static final String SCOPE = "home";

  /**
   * 현재 워크스페이스(요청 스레드의 active-tenant)의 홈 채팅 scope. 사용자 상한·생성 중 목록은 워크스페이스별이다 — scope 를 테넌트로 나누지 않으면
   * 여러 워크스페이스에 속한 사용자가 상한을 공유하고, 다른 워크스페이스의 생성 중 대화가 GET /ai/chat/active 에 섞인다. 테넌트 미해결(null)이면
   * "home:-" 로 따로 묶는다.
   */
  static String scope() {
    Long tenantId = TenantContext.get();
    return SCOPE + ":" + (tenantId == null ? "-" : tenantId);
  }

  /** 화면 컨텍스트 없는 호출(기존 호출부·테스트 호환) — null 컨텍스트, 첨부 없음으로 위임. */
  public HomeChatStartedResponse startChat(long callerId, UUID sessionId, String query) {
    return startChat(callerId, sessionId, query, null, List.of());
  }

  /** 첨부 없는 호출(기존 호출부·테스트 호환) — 첨부 없음으로 위임. */
  public HomeChatStartedResponse startChat(
      long callerId, UUID sessionId, String query, AiScreenContext screenContext) {
    return startChat(callerId, sessionId, query, screenContext, List.of());
  }

  /** 생성 id 를 서버가 발급하는 호출(기존 호출부·테스트 호환). */
  public HomeChatStartedResponse startChat(
      long callerId,
      UUID sessionId,
      String query,
      AiScreenContext screenContext,
      List<Long> fileIds) {
    return startChat(callerId, sessionId, query, screenContext, fileIds, null);
  }

  /**
   * 실행 슬롯 예약 → 비서 해석·세션 ensure·맥락 스냅샷·USER 영속(동기) → 펌프 제출. 실패는 4xx/5xx 로 그대로 던진다.
   *
   * <p>WP-190: 예약은 <b>무엇도 저장하기 전에</b> 한다 — 같은 대화 생성 중이면 409, 사용자 상한이면 429 이고 그때는 질문도 세션도 남지 않는다. 새
   * 대화는 id 를 미리 만들어 예약 키로 쓴다. 예약 뒤 어떤 실패든 슬롯을 돌려준다(새는 슬롯은 사용자 상한을 영구히 깎는다).
   *
   * @param callerId 요청 사용자 ID
   * @param sessionId null 이면 새 세션 생성
   * @param query 자연어 명령
   * @param screenContext 현재 화면 컨텍스트(WP-54, nullable) — 저장하지 않고 이번 요청에만 ai-agent 로 전달
   * @param fileIds 선업로드한 첨부 id(WP-234, null·빈 목록 허용) — USER 메시지와 같은 트랜잭션에서 연결·승격된다
   * @param correlationId 웹이 정한 생성 id(WP-267, nullable) — 없으면 서버가 발급한다. 진행 중인 생성과 겹치면 409
   * @return correlationId(이벤트 필터·취소) + sessionId(새 대화면 만든 id)
   */
  public HomeChatStartedResponse startChat(
      long callerId,
      UUID sessionId,
      String query,
      AiScreenContext screenContext,
      List<Long> fileIds,
      UUID correlationId) {
    // 1) enabled 확인 — 비활성이면 시작 전 예외로 단락.
    if (!aiAgentProperties.enabled()) {
      throw new HomeChatUnavailableException("AI 채팅 기능이 현재 비활성화되어 있어요.");
    }

    // WP-234: 공백뿐인 본문은 ""로 정규화(저장·ai-agent 전달 공통 — ai-agent 는 빈 문자열만 기본 문구로 바꾼다).
    String text = query == null || query.isBlank() ? "" : query;

    // 1-1) WP-234: 첨부 입력 사전 검증 — 예약·세션 생성 전에 걸러 잘못된 요청이 슬롯을 잡거나 빈 새 세션을 남기지 않게 한다.
    // 파일 존재·소유 판정은 새 세션일 때만(기존 세션은 USER 영속 단계의 잠금 경로가 같은 400 으로 거절). 아무것도 저장하지 않는다.
    attachmentService.precheck(callerId, text, fileIds, sessionId == null);

    // 2) 슬롯 예약(WP-190) — 새 대화면 예약 키로 쓸 id 를 먼저 만든다. 거절(409/429)되면 질문·세션·첨부 연결 무엇도 남지 않는다.
    UUID sid = sessionId != null ? sessionId : UUID.randomUUID();
    int limit = chatProperties.maxConcurrentPerUser();
    StreamingGenerationRegistry.Reservation reservation;
    try {
      reservation =
          registry.reserve(
              callerId,
              new StreamingGenerationRegistry.GenerationTag(scope(), sid.toString()),
              limit,
              correlationId == null ? null : correlationId.toString());
    } catch (StreamingGenerationRejectedException e) {
      throw e.reason() == StreamingGenerationRejectedException.Reason.BUSY
          ? new HomeChatSessionBusyException()
          : new HomeChatConcurrencyLimitException(limit);
    }
    // 예약 뒤 launch 까지의 모든 동기 구간 — 어떤 예외든 슬롯을 돌려주고 그대로 다시 던진다(launch 거절 포함, 반납은 멱등).
    // Error(StackOverflowError·OOM 등)까지 잡는다 — 놓치면 슬롯이 프로세스 수명 내내 새어 그 사용자의 상한이 영구히 줄어든다.
    try {
      return startReserved(
          callerId, sid, sessionId == null, text, fileIds, screenContext, reservation);
    } catch (Throwable e) {
      reservation.release();
      throw e;
    }
  }

  /** 예약 이후의 동기 구간 + 펌프 제출. 호출자(startChat)가 예외 시 예약을 반납한다. */
  private HomeChatStartedResponse startReserved(
      long callerId,
      UUID sid,
      boolean newSession,
      String text,
      List<Long> fileIds,
      AiScreenContext screenContext,
      StreamingGenerationRegistry.Reservation reservation) {
    // 3) 비서 해석 — 세션 생성보다 먼저(미설정이면 503 이고 빈 세션을 남기지 않는다).
    AssistantSpec spec = assistantResolver.resolve(callerId);

    // 4) 세션 ensure — 새 대화면 예약한 id 로 만든다.
    if (newSession) sessionService.create(callerId, sid);

    // 5) 현재 query 적재 전, 세션 맥락 스냅샷(누적 요약 + 경계 이후 원문)을 확보(WP-232). 예산 초과 시 압축은 pump 에서.
    HomeContextSummaryService.ContextSnapshot snapshot = contextService.load(callerId, sid);

    // 6) USER 메시지 영속 + 첨부 연결(WP-234) — 한 트랜잭션(세션 잠금·상한·승격·추출 요청 포함). 예약 뒤라 거절된 요청은 여기 오지 않는다.
    long userMessageId = attachmentService.appendUserMessage(callerId, sid, text, fileIds);

    // 6-1) WP-234: 세션 전체 첨부(요약 경계 이전 포함)를 매 턴 DB 에서 만든다 — 앞부분이 요약으로 바뀌어도 AI 가 파일을 안다.
    List<ChatAttachment> attachments = attachmentService.listForChat(callerId, sid, userMessageId);

    // 7) 이전 턴의 미처리 확인카드 만료(#843) — 웹은 새 질문 시 카드를 비우므로, 복원 시 되살아나지 않게 서버도 맞춘다.
    // 새 세션이면 만료할 카드가 없다.
    if (!newSession) {
      proposalService.expirePending(callerId, sid);
    }

    // #719: 요청 스레드의 active-tenant 를 미리 캡처해 pump 에서 ChatRequest 에 싣는다.
    Long tenantId = TenantContext.get();
    // 턴 1회의 이벤트 봉투(correlationId·sessionId)·누적(steps·blocks)·종결(정확히 한 번)을 맡는다.
    HomeChatTurn turn =
        new HomeChatTurn(callerId, sid, reservation, sessionService, sseRegistry, objectMapper);

    registry.launch(
        reservation,
        executor,
        TIMEOUT,
        () ->
            pump(
                turn,
                reservation,
                callerId,
                sid,
                text,
                screenContext,
                attachments,
                snapshot,
                spec,
                tenantId),
        // R4: 큐(core 4·queue 16) 대기 중 취소·타임아웃되면 태스크는 돌지 않는다 — 누적 텍스트가 없으니 저장 없이 cancelled 만 나가
        // 웹이 "생성 중" 에 갇히지 않는다.
        turn::cancel);
    return new HomeChatStartedResponse(reservation.correlationId(), sid);
  }

  /**
   * 펌프(전용 executor 스레드) — 맥락 예산 맞춤 → ai-agent 스트림 → 콜백별 이벤트·누적 → 종결. 종결은 HomeChatTurn 이 정확히 한 번
   * 처리한다(영속 → 반납 → 이벤트).
   */
  private void pump(
      HomeChatTurn turn,
      StreamingGenerationRegistry.Reservation reservation,
      long callerId,
      UUID sid,
      String query,
      AiScreenContext screenContext,
      List<ChatAttachment> attachments,
      HomeContextSummaryService.ContextSnapshot snapshot,
      AssistantSpec spec,
      Long tenantId) {
    try {
      // WP-232: 예산 초과 시 이 턴에서 동기 요약(진행 라벨 표시) — 요청 스레드를 막지 않도록 pump 에서 수행.
      HomeContextSummaryService.ContextSnapshot ctx =
          contextService.fitToBudget(
              callerId,
              sid,
              snapshot,
              spec,
              () -> turn.emit("home.chat.progress", Map.of("label", COMPACTING_LABEL)));
      // userId: 요청 사용자 ID — ai-agent 의 MCP 도구가 assistantAgentId 아닌 실제 요청자 컨텍스트로
      // 드라이브·캘린더 등 사용자 귀속 리소스를 조회·수정하게 한다(refs #376).
      // tenantId: 요청 스레드에서 캡처한 active-tenant(JwtAuthenticationFilter 가 설정) — ai-agent 가
      // workplace-api 대리 호출 시 X-On-Behalf-Of-Tenant 로 되돌려 보내야, 요청자가 다중/무 멤버십일 때
      // AgentTenantResolver 가 fail-closed(테넌트 미해결→RLS GUC 미주입→권한 전부 거부) 되지 않는다(#719).
      ChatRequest req =
          new ChatRequest(
              query,
              ctx.toContext(),
              spec.agentUserId(),
              callerId,
              tenantId,
              spec.model(),
              spec.thinkingDepth(),
              // compose 는 다중 조회·위임으로 기본 8턴을 넘기기 쉬워 하한(50)을 적용.
              Math.max(spec.maxTurns(), COMPOSE_MIN_MAX_TURNS),
              // #456: compose 는 다중 도메인 위임으로 기본 60s 를 넘기 쉬워 하한(180s)을 적용.
              Math.max(spec.timeoutMs(), COMPOSE_MIN_TIMEOUT_MS),
              // WP-54: 화면 컨텍스트 1:1 전달(USER 메시지 영속에는 포함하지 않는다).
              screenContext,
              ctx.summary(),
              // WP-234: 첨부 읽기 도구 세션 바인딩 + 세션 첨부 목록.
              sid.toString(),
              attachments);
      chatClient.composeStream(
          req,
          // delta: 블록 순서 기록 + 즉시 발행(done 본문은 ai-agent 가 준 fullText, 부분 저장은 누적 텍스트).
          delta -> {
            turn.blocks.onDelta(delta);
            turn.emit("home.chat.delta", Map.of("text", delta));
          },
          // done: 영속 → 반납 → home.chat.done → WP-232 비동기 요약 예약(예외 없음, 응답 지연 없음).
          (fullText, widgets) ->
              turn.complete(
                  fullText, widgets, () -> contextService.scheduleIfNeeded(callerId, sid)),
          // error(진짜 오류만 — 취소는 아래 마감·catch 로 별도 처리): 누적분 FAILED 저장 → 반납 → home.chat.error.
          turn::fail,
          // progress: 위임 라벨 누적 + 발행.
          label -> {
            turn.blocks.onStep(turn.steps.size());
            turn.steps.add(Map.of("kind", "delegation", "label", label));
            turn.emit("home.chat.progress", Map.of("label", label));
          },
          // pending_action: 제안을 먼저 영속(#843)해 id 를 붙인 뒤 발행 — 봉투의 sessionId 로 새 대화도 done 전에 세션을 안다.
          node ->
              turn.emit(
                  "home.chat.pending_action",
                  Map.of("actions", proposalService.record(callerId, sid, node))),
          toolNode -> onTool(turn, toolNode));
      // R8: composeStream 은 인터럽트로 줄 루프를 빠져나오면 콜백 없이 조용히 return 한다 — 종결 없이 끝났으면 여기서 마감.
      if (!turn.isFinished()) {
        if (Thread.currentThread().isInterrupted() || reservation.cancelReason() != null) {
          turn.cancel();
        } else {
          turn.fail("AI 응답이 완료되지 않았어요. 잠시 후 다시 시도해주세요.");
        }
      }
    } catch (Exception e) {
      // composeStream·fitToBudget(동기 요약) 은 인터럽트로 인한 예외만 여기까지 던진다(그 외 오류는
      // onError 콜백·요약 폴백에서 이미 처리) — WikiAiService/DriveOverviewService 와 동일 패턴.
      // 인터럽트 플래그·취소 사유도 본다 — fitToBudget 은 isUserCancel(플래그 포함)로 취소를 판별해 cause 체인에 인터럽트가
      // 없는 예외를 그대로 던질 수 있다. 체인만 보면 취소된 턴이 cancelled 대신 오류 메시지로 끝난다(WP-232).
      boolean cancelled =
          HomeInterruptions.isInterruption(e)
              || Thread.currentThread().isInterrupted()
              || reservation.cancelReason() != null;
      if (cancelled) {
        turn.cancel();
      } else {
        // 메시지 없는 예외도 있어 Map.of 의 null NPE 를 막는다.
        turn.fail(Objects.requireNonNullElse(e.getMessage(), "채팅 처리 중 오류가 발생했습니다"));
      }
    }
  }

  /** tool 이벤트 — 표시 가능 도구는 영속 단계에 추가(숨김 도구는 발행만), show_* 는 위젯 블록, result 는 단계 상태 갱신. */
  private void onTool(HomeChatTurn turn, JsonNode toolNode) {
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
          step.put("args", objectMapper.convertValue(toolNode.get("args"), Map.class));
        }
        step.put("status", "running");
        turn.blocks.onStep(turn.steps.size());
        turn.steps.add(step);
      } else {
        Map<String, Object> widget = widgetOf(toolName, toolNode.path("args"));
        if (widget != null) turn.blocks.onWidget(widget);
      }
    } else {
      boolean isError = toolNode.path("isError").asBoolean(false);
      for (Map<String, Object> s : turn.steps) {
        if ("tool".equals(s.get("kind"))
            && Integer.valueOf(seq).equals(s.get("seq"))
            && "running".equals(s.get("status"))) {
          s.put("status", isError ? "error" : "done");
          break;
        }
      }
    }
    @SuppressWarnings("unchecked")
    Map<String, Object> toolPayload = objectMapper.convertValue(toolNode, Map.class);
    turn.emit("home.chat.tool", toolPayload);
  }

  /** WP-190: 호출자의 생성 중 대화 + 상한(GET /ai/chat/active). */
  public HomeChatActiveResponse active(long callerId) {
    return new HomeChatActiveResponse(
        chatProperties.maxConcurrentPerUser(),
        registry.active(callerId, scope()).stream()
            .map(
                g ->
                    new HomeChatActiveResponse.Item(
                        UUID.fromString(g.key()), g.correlationId(), g.startedAt()))
            .toList());
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
}
