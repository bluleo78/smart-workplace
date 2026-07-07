package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.realtime.DefaultStreamingGenerationRegistry;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.realtime.StreamingGenerationRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.home.outbound.ChatMessages.ChatRequest;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * HomeChatService 의 progress·pending_action·tool 콜백 → 통합 /events 채널(SseRegistry.fanOut) 이벤트 포워드
 * 검증(#593 편입).
 *
 * <p>SseRegistry 를 목으로 대체해 fanOut(userIds, eventName, payload) 호출을 캡처한다.
 * StreamingGenerationRegistry 는 실제 구현(DefaultStreamingGenerationRegistry)을 써서 correlationId 발급까지 실제
 * 경로로 검증한다.
 *
 * <p>MailSummaryScheduler 가 컨텍스트 기동 직후 TenantScopedRunner.forEachActiveTenant 콜백 안에서
 * assistantResolver.resolveWorkspaceOrEmpty() 를 호출해, 테스트 스레드의 스터빙과 동시 실행되면 Mockito 상태가 오염돼 간헐적으로
 * flake 한다(HomeChatServiceTest 와 동일 패턴). TenantScopedRunner 를 mock 으로 대체해 원천 차단한다.
 */
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class HomeChatServiceForwardTest extends IntegrationTestBase {

  @MockitoBean AiAgentChatClient chatClient;
  @MockitoBean AssistantResolver assistantResolver;
  @MockitoBean TenantScopedRunner tenantScopedRunner;
  @Autowired HomeSessionService sessionService;
  @Autowired AiAgentProperties aiAgentProperties;
  @Autowired ObjectMapper objectMapper;

  @Autowired
  @org.springframework.beans.factory.annotation.Qualifier("aiChatStreamExecutor")
  AsyncTaskExecutor aiChatStreamExecutor;

  private final List<Long> createdUserIds = new ArrayList<>();

  /**
   * #512 누수 차단: 비동기 펌프가 커밋한 home_session(메시지 CASCADE)은 user 삭제로 함께 회수된다. USER 는 RLS 비대상이라 트랜잭션 없이
   * 삭제 가능.
   */
  @org.junit.jupiter.api.AfterEach
  void cleanupUsers() {
    if (!createdUserIds.isEmpty()) {
      baseDsl
          .deleteFrom(com.workplace.jooq.Tables.USER)
          .where(com.workplace.jooq.Tables.USER.ID.in(createdUserIds))
          .execute();
      createdUserIds.clear();
    }
    // #719 테스트가 설정한 TenantContext 가 다른 테스트로 새지 않도록 매번 정리.
    TenantContext.clear();
  }

  /** createAgentUser(base) + 생성 id 추적 — @AfterEach 에서 회수. */
  private long seedAgent(String prefix) {
    long id = createAgentUser(prefix);
    createdUserIds.add(id);
    return id;
  }

  /** fanOut 으로 전송된 (eventName, payload) 쌍을 모으는 기록 컨테이너. */
  static final class SentEvent {
    final String name;
    final Object data;

    SentEvent(String name, Object data) {
      this.name = name;
      this.data = data;
    }
  }

  /** SseRegistry.fanOut() 을 가로채 전송 이벤트를 캡처하는 목 + 실제 레지스트리로 조립한 서비스 인스턴스. */
  private HomeChatService serviceCapturing(List<SentEvent> captured) {
    SseRegistry capturingSseRegistry = mock(SseRegistry.class);
    doAnswer(
            inv -> {
              String eventName = inv.getArgument(1);
              Object payload = inv.getArgument(2);
              captured.add(new SentEvent(eventName, payload));
              return null;
            })
        .when(capturingSseRegistry)
        .fanOut(any(), any(), any());

    StreamingGenerationRegistry registry = new DefaultStreamingGenerationRegistry();
    return new HomeChatService(
        sessionService,
        chatClient,
        aiAgentProperties,
        objectMapper,
        assistantResolver,
        aiChatStreamExecutor,
        registry,
        capturingSseRegistry);
  }

  private void stubAssistant() {
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
  }

  /**
   * onProgress 콜백이 호출되면 home.chat.progress 가 fanOut 되는지 검증.
   *
   * <p>composeClient.composeStream 을 가로채 onProgress("캘린더 전문가에게 위임 중") → onDone 순으로 즉시 호출한다.
   * CountDownLatch 로 펌프 완료를 기다린 뒤, 캡처된 이벤트 목록에서 progress + 라벨을 단언한다.
   */
  @Test
  void progress_콜백을_받으면_home_chat_progress_이벤트를_fanOut_한다() throws Exception {
    long uid = seedAgent("fwd-prog");
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
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    List<SentEvent> captured = new ArrayList<>();
    String correlationId = serviceCapturing(captured).startChat(uid, null, "다음주 회의 잡아줘");

    // 펌프 완료 대기(최대 5초).
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    // progress 이벤트가 fanOut 되고 라벨 + correlationId 가 포함됐는지 검증.
    List<SentEvent> progressEvents =
        captured.stream().filter(e -> "home.chat.progress".equals(e.name)).toList();
    assertThat(progressEvents).isNotEmpty();
    @SuppressWarnings("unchecked")
    Map<String, Object> payload = (Map<String, Object>) progressEvents.get(0).data;
    assertThat(payload).containsEntry("label", "캘린더 전문가에게 위임 중");
    assertThat(payload).containsEntry("correlationId", correlationId);
  }

  /**
   * onPendingAction 콜백이 호출되면 home.chat.pending_action 이 { correlationId, actions } 봉투로 fanOut 되는지
   * 검증(공통 payload 봉투 규약, #593).
   */
  @Test
  void pending_action_콜백을_받으면_correlationId_actions_봉투로_fanOut_한다() throws Exception {
    long uid = seedAgent("fwd-pa");
    stubAssistant();

    // AiAgentChatClient 계약상 onPendingAction 은 항상 ArrayNode 로 전달된다(단일 객체도 길이1 배열로 래핑).
    JsonNode proposal =
        objectMapper.readTree(
            "[{\"actionType\":\"calendar.create_event\",\"summary\":\"내일 10시\",\"params\":{}}]");
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
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    List<SentEvent> captured = new ArrayList<>();
    String correlationId = serviceCapturing(captured).startChat(uid, null, "내일 10시 회의 잡아줘");

    // 펌프 완료 대기(최대 5초).
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    // pending_action 이벤트가 { correlationId, actions } 봉투로 fanOut 됐는지 검증.
    List<SentEvent> pendingEvents =
        captured.stream().filter(e -> "home.chat.pending_action".equals(e.name)).toList();
    assertThat(pendingEvents).isNotEmpty();
    @SuppressWarnings("unchecked")
    Map<String, Object> payload = (Map<String, Object>) pendingEvents.get(0).data;
    assertThat(payload).containsEntry("correlationId", correlationId);
    assertThat(payload).containsKey("actions");
    assertThat(payload.get("actions").toString()).contains("calendar.create_event");
  }

  /**
   * #431: onDone 이 위젯 스펙과 함께 호출되면 home.chat.done payload 에 widgets 가 포함되는지 검증.
   *
   * <p>위젯 렌더 표면 복원의 핵심 — API 가 done 이벤트로 widgets[] 를 클라이언트에 패스스루해야 챗 도크가 메일/이슈 목록을 인라인 렌더할 수 있다.
   */
  @Test
  void done_콜백의_위젯을_home_chat_done_payload_에_포함한다() throws Exception {
    long uid = seedAgent("fwd-widgets");
    stubAssistant();

    JsonNode widgets =
        objectMapper.readTree("[{\"type\":\"mail_list\",\"params\":{\"folder\":\"INBOX\"}}]");
    CountDownLatch latch = new CountDownLatch(1);
    doAnswer(
            inv -> {
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              // show_mail_list 단독 응답 — fullText 는 비어 있고 widgets 만 존재.
              onDone.accept("", widgets);
              latch.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    List<SentEvent> captured = new ArrayList<>();
    String correlationId = serviceCapturing(captured).startChat(uid, null, "메일 보여줘");

    // 펌프 완료 대기(최대 5초).
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    // home.chat.done 이 fanOut 되고 correlationId + sessionId + widgets(mail_list) 가 함께 실렸는지 검증.
    List<SentEvent> doneEvents =
        captured.stream().filter(e -> "home.chat.done".equals(e.name)).toList();
    assertThat(doneEvents).isNotEmpty();
    @SuppressWarnings("unchecked")
    Map<String, Object> payload = (Map<String, Object>) doneEvents.get(0).data;
    assertThat(payload).containsEntry("correlationId", correlationId);
    assertThat(payload).containsKey("sessionId");
    assertThat(payload.get("widgets").toString()).contains("mail_list");
  }

  /**
   * #351: onPendingAction 콜백이 배열 ArrayNode 를 받으면 home.chat.pending_action payload 의 actions 필드에 배열
   * 전부가 그대로 중계되는지 검증.
   */
  @Test
  void pendingAction_다건_배열_중계() throws Exception {
    long uid = seedAgent("fwd-pa-array");
    stubAssistant();

    // 2건 배열 노드: [{actionType, summary, params}, {...}]
    com.fasterxml.jackson.databind.node.ArrayNode proposals =
        (com.fasterxml.jackson.databind.node.ArrayNode)
            objectMapper.readTree(
                "[{\"actionType\":\"calendar.create_event\",\"summary\":\"내일 10시\",\"params\":{}},"
                    + "{\"actionType\":\"mail.send\",\"summary\":\"메일 보내기\",\"params\":{}}]");
    CountDownLatch latch = new CountDownLatch(1);
    doAnswer(
            inv -> {
              Consumer<JsonNode> onPending = inv.getArgument(5);
              onPending.accept(proposals);
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDone.accept("제안했어요", null);
              latch.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    List<SentEvent> captured = new ArrayList<>();
    serviceCapturing(captured).startChat(uid, null, "내일 10시 회의 잡고 메일도 보내줘");

    // 펌프 완료 대기(최대 5초).
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    // pending_action 이벤트가 fanOut 되고 actions 배열에 두 actionType 이 모두 포함됐는지 검증.
    List<SentEvent> pendingEvents =
        captured.stream().filter(e -> "home.chat.pending_action".equals(e.name)).toList();
    assertThat(pendingEvents).isNotEmpty();
    @SuppressWarnings("unchecked")
    Map<String, Object> payload = (Map<String, Object>) pendingEvents.get(0).data;
    assertThat(payload.get("actions")).isInstanceOf(List.class);
    @SuppressWarnings("unchecked")
    List<Object> actions = (List<Object>) payload.get("actions");
    assertThat(actions).hasSize(2);
    assertThat(payload.toString()).contains("calendar.create_event");
    assertThat(payload.toString()).contains("mail.send");
  }

  /**
   * Task 8: progress + tool 이벤트를 누적해 ASSISTANT 메시지 tool_calls 에 저장하고 home.chat.* 로 fanOut 하는지 검증.
   *
   * <p>onProgress("위임중") → onTool(start) → onTool(result) → onDone 순으로 즉시 호출하고, 저장된 ASSISTANT 메시지의
   * toolCalls 와 캡처된 fanOut 이벤트를 단언한다.
   */
  @Test
  void progress와_tool_이벤트를_누적해_ASSISTANT_메시지에_저장하고_home_chat으로_fanOut한다() throws Exception {
    long uid = seedAgent("fwd-tool-persist");
    stubAssistant();

    JsonNode toolStart =
        objectMapper.readTree(
            "{\"seq\":1,\"phase\":\"start\",\"toolName\":\"update_issue_status\",\"args\":{\"id\":10}}");
    JsonNode toolResult =
        objectMapper.readTree("{\"seq\":1,\"phase\":\"result\",\"isError\":false}");

    CountDownLatch latch = new CountDownLatch(1);
    doAnswer(
            inv -> {
              Consumer<String> onProgress = inv.getArgument(4);
              onProgress.accept("이슈 전문가에게 위임 중");
              Consumer<JsonNode> onTool = inv.getArgument(6);
              onTool.accept(toolStart);
              onTool.accept(toolResult);
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDone.accept("이슈 상태를 변경했어요", null);
              latch.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    List<SentEvent> captured = new ArrayList<>();
    HomeChatService svc = serviceCapturing(captured);
    svc.startChat(uid, null, "이슈 10번 완료 처리해줘");

    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    // fanOut: tool 이벤트가 최소 2회 전달됐는지 검증 + correlationId 병합 확인.
    List<SentEvent> toolEvents =
        captured.stream().filter(e -> "home.chat.tool".equals(e.name)).toList();
    assertThat(toolEvents).hasSize(2);
    @SuppressWarnings("unchecked")
    Map<String, Object> firstToolPayload = (Map<String, Object>) toolEvents.get(0).data;
    assertThat(firstToolPayload).containsEntry("toolName", "update_issue_status");
    assertThat(firstToolPayload).containsKey("correlationId");

    // DB: ASSISTANT 메시지의 tool_calls 가 누적 내용으로 저장됐는지 검증.
    List<HomeMessageResponse> all =
        sessionService.list(uid, null, 1).items().stream()
            .findFirst()
            .map(s -> sessionService.getMessages(uid, s.id()))
            .orElseThrow();
    HomeMessageResponse assistant =
        all.stream().filter(m -> "ASSISTANT".equals(m.role())).findFirst().orElseThrow();
    assertThat(assistant.toolCalls()).isNotNull();
    String toolCallsStr = assistant.toolCalls().toString();
    // delegation 항목(kind:delegation, label) 포함 검증
    assertThat(toolCallsStr).contains("delegation");
    assertThat(toolCallsStr).contains("이슈 전문가에게 위임 중");
    // tool 항목(kind:tool, toolName, status:done) 포함 검증
    assertThat(toolCallsStr).contains("update_issue_status");
    assertThat(toolCallsStr).contains("done");
  }

  /**
   * #456: compose 가 ai-agent 로 보내는 ChatRequest 의 timeoutMs 가 compose 하한(180s)으로 상향되는지 검증.
   *
   * <p>비서 기본 timeoutMs 는 60s(AssistantDefaults.TIMEOUT_MS)인데, Global Chat 은 다중 도메인 위임으로 60s 를 종종
   * 초과한다. compose 경로는 하한을 적용해 ≥180s 를 전달해야 한다. 상수 비교가 아닌 실제 전송된 요청 본문을 캡처해 검증한다.
   */
  @Test
  void compose_요청_timeoutMs_를_180s_하한으로_상향한다() throws Exception {
    long uid = seedAgent("fwd-timeout-floor");
    // 기본 비서: timeoutMs=60000 (공유 기본값).
    stubAssistant();

    CountDownLatch latch = new CountDownLatch(1);
    var reqCaptor = org.mockito.ArgumentCaptor.forClass(ChatRequest.class);
    doAnswer(
            inv -> {
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDone.accept("처리했어요", null);
              latch.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    List<SentEvent> captured = new ArrayList<>();
    serviceCapturing(captured).startChat(uid, null, "오늘 일정 확인 + 메일도");

    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    // 전송된 ChatRequest 를 캡처해 timeoutMs 가 하한(180_000)으로 상향됐는지 검증.
    org.mockito.Mockito.verify(chatClient)
        .composeStream(reqCaptor.capture(), any(), any(), any(), any(), any(), any());
    assertThat(reqCaptor.getValue().timeoutMs()).isEqualTo(180_000);
  }

  /**
   * #719: 요청 스레드의 TenantContext(active-tenant) 를 ChatRequest.tenantId 로 전달하는지 검증.
   *
   * <p>이 값이 ai-agent → workplace-api 대리 호출의 X-On-Behalf-Of-Tenant 헤더로 이어져, 다중/무 멤버십 요청자에서
   * AgentTenantResolver 가 fail-closed(권한 전부 거부) 되는 것을 막는다.
   */
  @Test
  void 요청_스레드의_TenantContext_를_ChatRequest_tenantId_로_전달한다() throws Exception {
    long uid = seedAgent("fwd-tenant");
    stubAssistant();
    TenantContext.set(1L);

    CountDownLatch latch = new CountDownLatch(1);
    var reqCaptor = org.mockito.ArgumentCaptor.forClass(ChatRequest.class);
    doAnswer(
            inv -> {
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDone.accept("처리했어요", null);
              latch.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    List<SentEvent> captured = new ArrayList<>();
    serviceCapturing(captured).startChat(uid, null, "양정모님에 대해서 알려줘");

    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    org.mockito.Mockito.verify(chatClient)
        .composeStream(reqCaptor.capture(), any(), any(), any(), any(), any(), any());
    assertThat(reqCaptor.getValue().tenantId()).isEqualTo(1L);
  }

  /**
   * #719: TenantContext 가 설정되지 않은 요청(예: 테넌트 미해결 경로)은 tenantId 를 null 로 전달해야 한다 — 값을 조작해 임의 테넌트로
   * 위장하지 않는다.
   */
  @Test
  void TenantContext_가_없으면_tenantId_는_null_이다() throws Exception {
    long uid = seedAgent("fwd-tenant-null");
    stubAssistant();
    TenantContext.clear();

    CountDownLatch latch = new CountDownLatch(1);
    var reqCaptor = org.mockito.ArgumentCaptor.forClass(ChatRequest.class);
    doAnswer(
            inv -> {
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDone.accept("처리했어요", null);
              latch.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    List<SentEvent> captured = new ArrayList<>();
    serviceCapturing(captured).startChat(uid, null, "안녕");

    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    org.mockito.Mockito.verify(chatClient)
        .composeStream(reqCaptor.capture(), any(), any(), any(), any(), any(), any());
    assertThat(reqCaptor.getValue().tenantId()).isNull();
  }

  /**
   * Task 9: 세션 메시지 복원 응답에 toolCalls 가 포함되는지 검증.
   *
   * <p>tool_calls 가 채워진 ASSISTANT 메시지를 직접 appendMessage 로 삽입하고 getMessages 응답에 toolCalls 가 나오는지
   * 단언한다.
   */
  @Test
  void 복원_응답에_tool_calls_가_포함된다() {
    long uid = seedAgent("restore-tool-calls");
    var s = sessionService.create(uid);
    String toolCallsJson =
        "[{\"kind\":\"delegation\",\"label\":\"전문가 위임\"},{\"kind\":\"tool\",\"seq\":1,\"toolName\":\"get_issue\",\"status\":\"done\"}]";
    sessionService.appendMessage(uid, s.id(), "USER", "이슈 조회해줘", null, null);
    sessionService.appendMessage(uid, s.id(), "ASSISTANT", "조회했어요", null, toolCallsJson);

    List<HomeMessageResponse> msgs = sessionService.getMessages(uid, s.id());
    HomeMessageResponse assistant =
        msgs.stream().filter(m -> "ASSISTANT".equals(m.role())).findFirst().orElseThrow();
    assertThat(assistant.toolCalls()).isNotNull();
    assertThat(assistant.toolCalls().isArray()).isTrue();
    assertThat(assistant.toolCalls().toString()).contains("get_issue");
    assertThat(assistant.toolCalls().toString()).contains("delegation");
  }
}
