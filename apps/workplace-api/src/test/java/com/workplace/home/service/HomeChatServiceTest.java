package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeSessionSummary;
import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.home.outbound.ChatMessages.ChatRequest;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * HomeChatService 통합 테스트 — SSE 패스스루 + done 영속 검증.
 *
 * <p>AiAgentChatClient 는 Mockito bean 으로 대체해 실제 ai-agent 없이 테스트한다. composeStream 은 비동기 펌프를 제출하므로
 * CountDownLatch 로 done 완료를 기다린다. @Transactional 을 쓰지 않는다 — 펌프 스레드의 ASSISTANT appendMessage 가 별도 tx
 * 로 커밋되어야 하기 때문이다.
 */
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class HomeChatServiceTest extends IntegrationTestBase {

  @Autowired HomeChatService composeService;
  @Autowired HomeSessionService sessionService;
  @Autowired ObjectMapper objectMapper;
  @Autowired DSLContext dsl;
  @MockitoBean AiAgentChatClient chatClient;
  @MockitoBean AssistantResolver assistantResolver;

  private void stubAssistant() {
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
  }

  private final java.util.List<Long> createdUserIds = new java.util.ArrayList<>();

  /**
   * #512 누수 차단: 비동기 펌프가 커밋한 home_session(메시지 CASCADE)은 user 삭제로 함께 회수된다. USER 는 RLS 비대상이라 트랜잭션 없이
   * 삭제 가능.
   */
  @org.junit.jupiter.api.AfterEach
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

  private JsonNode widgets(String json) throws Exception {
    return objectMapper.readTree(json);
  }

  /**
   * delta×2 + done 시퀀스를 시뮬레이션한다. composeClient.composeStream 을 가로채 onDelta 를 2회, onDone 을 1회 즉시
   * 호출한다. CountDownLatch 로 펌프 완료를 기다린 뒤 세션 메시지를 조회해 USER/ASSISTANT 영속을 검증한다.
   */
  @Test
  void sessionId_null_이면_새_세션_생성하고_USER_ASSISTANT_영속() throws Exception {
    long uid = user("compose" + System.nanoTime());
    stubAssistant();

    // composeStream 은 void 반환 → doAnswer 사용. delta×2 + done 즉시 호출.
    CountDownLatch doneLatch = new CountDownLatch(1);
    doAnswer(
            inv -> {
              java.util.function.Consumer<String> onDelta = inv.getArgument(1);
              java.util.function.BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDelta.accept("내 ");
              onDelta.accept("할 일이에요");
              onDone.accept("내 할 일이에요", widgets("[{\"type\":\"my_tasks\",\"params\":{}}]"));
              doneLatch.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    SseEmitter emitter = composeService.chatStream(uid, null, "내 할 일");
    assertThat(emitter).isNotNull();

    // 펌프 완료 대기(최대 5초).
    assertThat(doneLatch.await(5, TimeUnit.SECONDS)).isTrue();

    // 세션 목록 조회 후 메시지 검증.
    List<HomeSessionSummary> summaries = sessionService.list(uid, null, 10).items();
    assertThat(summaries).hasSize(1);
    UUID sid = summaries.get(0).id();

    List<HomeMessageResponse> msgs = sessionService.getMessages(uid, sid);
    assertThat(msgs).hasSize(2);
    assertThat(msgs.get(0).role()).isEqualTo("USER");
    assertThat(msgs.get(0).content()).isEqualTo("내 할 일");
    assertThat(msgs.get(1).role()).isEqualTo("ASSISTANT");
    assertThat(msgs.get(1).content()).isEqualTo("내 할 일이에요");
    assertThat(msgs.get(1).widgets().get(0).get("type").asText()).isEqualTo("my_tasks");
  }

  /**
   * 표시 가능 도구(update_status)와 숨김 도구(respond_chat, show_issue_list)를 동시에 포함하는 스트림에서 tool_calls 가 표시
   * 가능 도구만 영속하는지 검증. 숨김 도구는 SSE 패스스루만 되고 tool_calls 에 포함되지 않아야 한다.
   */
  @Test
  void 표시가능_도구만_tool_calls_에_영속되고_숨김_도구는_제외() throws Exception {
    long uid = user("toolfilter" + System.nanoTime());
    stubAssistant();

    CountDownLatch doneLatch = new CountDownLatch(1);
    doAnswer(
            inv -> {
              java.util.function.BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              java.util.function.Consumer<com.fasterxml.jackson.databind.JsonNode> onTool =
                  inv.getArgument(6);

              // 숨김 도구: respond_chat (내부 응답 배관)
              onTool.accept(
                  objectMapper.readTree(
                      "{\"phase\":\"start\",\"seq\":1,\"toolName\":\"respond_chat\","
                          + "\"args\":{\"response\":\"안녕하세요\"}}"));
              onTool.accept(
                  objectMapper.readTree(
                      "{\"phase\":\"result\",\"seq\":1,\"toolName\":\"respond_chat\","
                          + "\"isError\":false}"));

              // 표시 가능 도구: update_status
              onTool.accept(
                  objectMapper.readTree(
                      "{\"phase\":\"start\",\"seq\":2,\"toolName\":\"update_status\","
                          + "\"args\":{\"issueKey\":\"EX-1\",\"status\":\"IN_PROGRESS\"}}"));
              onTool.accept(
                  objectMapper.readTree(
                      "{\"phase\":\"result\",\"seq\":2,\"toolName\":\"update_status\","
                          + "\"isError\":false}"));

              // 숨김 도구: show_issue_list (위젯으로 표시됨)
              onTool.accept(
                  objectMapper.readTree(
                      "{\"phase\":\"start\",\"seq\":3,\"toolName\":\"show_issue_list\","
                          + "\"args\":{}}"));
              onTool.accept(
                  objectMapper.readTree(
                      "{\"phase\":\"result\",\"seq\":3,\"toolName\":\"show_issue_list\","
                          + "\"isError\":false}"));

              onDone.accept("상태를 변경했어요", null);
              doneLatch.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    composeService.chatStream(uid, null, "EX-1 상태 변경해줘");
    assertThat(doneLatch.await(5, TimeUnit.SECONDS)).isTrue();

    List<HomeSessionSummary> summaries = sessionService.list(uid, null, 10).items();
    UUID sid = summaries.get(0).id();
    List<HomeMessageResponse> msgs = sessionService.getMessages(uid, sid);
    HomeMessageResponse assistant = msgs.get(1);

    // tool_calls 에 update_status 만 포함, respond_chat / show_issue_list 는 제외.
    assertThat(assistant.toolCalls()).isNotNull();
    assertThat(assistant.toolCalls().isArray()).isTrue();
    assertThat(assistant.toolCalls()).hasSize(1);
    assertThat(assistant.toolCalls().get(0).get("toolName").asText()).isEqualTo("update_status");
    assertThat(assistant.toolCalls().get(0).get("status").asText()).isEqualTo("done");
  }

  /**
   * 숨김 도구만 있는 스트림(respond_chat 단독)은 tool_calls 가 null 로 영속되는지 검증. steps 리스트가 비어 있으면 serializeSteps
   * 가 null 을 반환한다.
   */
  @Test
  void 숨김_도구만_있으면_tool_calls_는_null_로_영속() throws Exception {
    long uid = user("toolnull" + System.nanoTime());
    stubAssistant();

    CountDownLatch doneLatch = new CountDownLatch(1);
    doAnswer(
            inv -> {
              java.util.function.BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              java.util.function.Consumer<com.fasterxml.jackson.databind.JsonNode> onTool =
                  inv.getArgument(6);

              // 숨김 도구만
              onTool.accept(
                  objectMapper.readTree(
                      "{\"phase\":\"start\",\"seq\":1,\"toolName\":\"respond_chat\","
                          + "\"args\":{\"response\":\"안녕\"}}"));
              onTool.accept(
                  objectMapper.readTree(
                      "{\"phase\":\"result\",\"seq\":1,\"toolName\":\"respond_chat\","
                          + "\"isError\":false}"));

              onDone.accept("안녕하세요", null);
              doneLatch.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    composeService.chatStream(uid, null, "안녕");
    assertThat(doneLatch.await(5, TimeUnit.SECONDS)).isTrue();

    List<HomeSessionSummary> summaries = sessionService.list(uid, null, 10).items();
    UUID sid = summaries.get(0).id();
    List<HomeMessageResponse> msgs = sessionService.getMessages(uid, sid);
    HomeMessageResponse assistant = msgs.get(1);

    // 숨김 도구만 → tool_calls null
    assertThat(assistant.toolCalls()).isNull();
  }

  /** 기존 세션의 최근 메시지를 recentContext 로 전달하는지 검증. */
  @Test
  void 기존_세션의_최근메시지를_recentContext_로_전달_현재query_제외() throws Exception {
    long uid = user("ctx" + System.nanoTime());
    var s = sessionService.create(uid);
    // 사전 대화 1턴 적재.
    sessionService.appendMessage(uid, s.id(), "USER", "내 담당 보여줘", null, null);
    sessionService.appendMessage(
        uid,
        s.id(),
        "ASSISTANT",
        "내 담당이에요",
        "[{\"type\":\"issue_list\",\"params\":{\"assignee\":\"me\"}}]",
        null);
    stubAssistant();

    CountDownLatch doneLatch = new CountDownLatch(1);
    doAnswer(
            inv -> {
              java.util.function.BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDone.accept("HIGH 만 추렸어요", null);
              doneLatch.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());

    composeService.chatStream(uid, s.id(), "그 중 HIGH 만");
    assertThat(doneLatch.await(5, TimeUnit.SECONDS)).isTrue();

    ArgumentCaptor<ChatRequest> captor = ArgumentCaptor.forClass(ChatRequest.class);
    verify(chatClient).composeStream(captor.capture(), any(), any(), any(), any(), any(), any());
    ChatRequest sent = captor.getValue();
    assertThat(sent.query()).isEqualTo("그 중 HIGH 만");
    // recentContext: 직전 2개(USER/ASSISTANT) 텍스트만, 현재 query 는 미포함.
    assertThat(sent.recentContext()).extracting("content").containsExactly("내 담당 보여줘", "내 담당이에요");
  }
}
