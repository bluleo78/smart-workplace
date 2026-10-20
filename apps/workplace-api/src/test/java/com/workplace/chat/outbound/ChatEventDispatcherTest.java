package com.workplace.chat.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.global.ai.SharedAiMemoryReader;
import com.workplace.global.ai.SharedMemories;
import com.workplace.global.ai.SharedMemoryLine;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.EventEnvelope;
import com.workplace.user.service.ServerAgentResolver;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

class ChatEventDispatcherTest {

  private AiAgentEventClient client;
  private AiAgentProperties props;
  private ServerAgentResolver resolver;
  private SharedAiMemoryReader sharedReader;
  private ChatEventDispatcher dispatcher;

  @BeforeEach
  void setUp() {
    client = Mockito.mock(AiAgentEventClient.class);
    props = Mockito.mock(AiAgentProperties.class);
    when(props.enabled()).thenReturn(true);
    resolver = Mockito.mock(ServerAgentResolver.class);
    sharedReader = Mockito.mock(SharedAiMemoryReader.class);
    // 기본: 멘션된 AGENT 는 내부(INTERNAL) 실행으로 취급 — 외부 케이스는 internalAgents(...) 로 따로 지정.
    internalAgents(AGENT.id());
    dispatcher = new ChatEventDispatcher(client, props, resolver, sharedReader);
  }

  /**
   * resolver 를 "주어진 id 만 INTERNAL" 로 스텁한다 — 실제 규칙(후보 순서상 첫 INTERNAL AGENT)과 같은 모양. DB 규칙 자체는
   * ServerAgentResolverTest 가 검증한다.
   */
  private void internalAgents(Long... ids) {
    var internal = Set.of(ids);
    // doAnswer 형태로 스텁한다 — when(...) 재스텁은 이전 Answer 를 null 인자로 한 번 호출해 NPE 가 난다.
    doAnswer(
            inv ->
                inv.<List<UserSummary>>getArgument(0).stream()
                    .filter(u -> "AGENT".equals(u.kind()) && internal.contains(u.id()))
                    .map(UserSummary::id)
                    .findFirst()
                    .orElse(null))
        .when(resolver)
        .pickActingAgent(any(), any());
  }

  /** WP-386: 이슈 채팅 이벤트에 조직 + 그 프로젝트 공용 메모리를 싣는다. */
  @Test
  void 공용_메모리를_payload_에_싣는다() {
    var shared = new SharedMemories(List.of(new SharedMemoryLine("조직", "답은 존댓말로")), 0);
    when(sharedReader.readForProjectAgent("WP", AGENT.id())).thenReturn(shared);
    dispatcher.onChatMessageCreated(event(HUMAN, List.of(AGENT)));
    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client).publish(captor.capture());
    assertThat(captor.getValue().payload()).containsEntry("sharedMemories", shared.items());
    assertThat(captor.getValue().payload()).containsEntry("sharedMemoryMoreCount", 0);
  }

  private static final UserSummary HUMAN = new UserSummary(1L, "alice", "Alice", "HUMAN");
  private static final UserSummary AGENT = new UserSummary(99L, "ai-agent", "AI Agent", "AGENT");

  private ChatMessageCreatedEvent event(UserSummary actor, List<UserSummary> mentions) {
    return new ChatMessageCreatedEvent(
        1L,
        10L,
        100L,
        "WP",
        "WP-1",
        "로그인 버그",
        "IN_PROGRESS",
        "재현 절차: 로그인 시 500",
        actor,
        "@ai",
        mentions,
        List.of(),
        List.of(),
        false,
        ChatMessageOrigin.USER,
        Instant.now());
  }

  /** WP-638: 남(HUMAN id 1)의 것이 아닌 개인 비서(주인 id 7)를 멘션해도 주인의 키로 실행하지 않는다. */
  @Test
  void mentionOfOthersPersonalAssistant_doesNotPublish() {
    var othersAssistant = new UserSummary(77L, "__assistant_u7", "Work Loop Admin", "AGENT");
    internalAgents(othersAssistant.id());
    dispatcher.onChatMessageCreated(event(HUMAN, List.of(othersAssistant)));
    verify(client, never()).publish(any());
  }

  /** WP-638: 내(HUMAN id 1) 개인 비서는 그대로 부를 수 있다. */
  @Test
  void mentionOfOwnPersonalAssistant_publishes() {
    var myAssistant = new UserSummary(78L, "__assistant_u1", "내 비서", "AGENT");
    internalAgents(myAssistant.id());
    dispatcher.onChatMessageCreated(event(HUMAN, List.of(myAssistant)));
    verify(client, times(1)).publish(any());
  }

  @Test
  void humanWithAgentMention_publishes() {
    dispatcher.onChatMessageCreated(event(HUMAN, List.of(AGENT)));
    ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, times(1)).publish(captor.capture());
    assertThat(captor.getValue().type()).isEqualTo("chat.message.posted");
  }

  /**
   * WP-386: 이슈 채팅 envelope 을 실제 Jackson 으로 직렬화한 와이어 모양을 잠근다(AiAgentEventClient 의 RestClient 가
   * envelope 을 그대로 JSON 으로 보낸다) — sharedMemories 는 {space, content} 객체 배열, sharedMemoryMoreCount 는
   * 숫자.
   */
  @Test
  void 공용_메모리는_와이어에서_space_content_배열과_숫자다() throws Exception {
    var shared = new SharedMemories(List.of(new SharedMemoryLine("조직", "답은 존댓말로")), 3);
    when(sharedReader.readForProjectAgent("WP", AGENT.id())).thenReturn(shared);
    dispatcher.onChatMessageCreated(event(HUMAN, List.of(AGENT)));
    ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client).publish(captor.capture());

    JsonNode payload =
        new ObjectMapper()
            .readTree(new ObjectMapper().writeValueAsString(captor.getValue()))
            .get("payload");

    assertThat(payload.get("sharedMemories").toString())
        .isEqualTo("[{\"space\":\"조직\",\"content\":\"답은 존댓말로\"}]");
    assertThat(payload.get("sharedMemoryMoreCount").isNumber()).isTrue();
    assertThat(payload.get("sharedMemoryMoreCount").asInt()).isEqualTo(3);
  }

  /** #368: payload 에 이슈 컨텍스트(title·status·body)가 동봉되어 AI 가 이슈를 인지할 수 있어야 한다. */
  @Test
  void publishedPayload_carriesIssueContext() {
    dispatcher.onChatMessageCreated(event(HUMAN, List.of(AGENT)));
    ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, times(1)).publish(captor.capture());
    var payload = captor.getValue().payload();
    assertThat(payload.get("issueTitle")).isEqualTo("로그인 버그");
    assertThat(payload.get("issueStatus")).isEqualTo("IN_PROGRESS");
    assertThat(payload.get("issueBody")).isEqualTo("재현 절차: 로그인 시 500");
  }

  @Test
  void humanNoMention_skipped() {
    dispatcher.onChatMessageCreated(event(HUMAN, List.of()));
    verify(client, never()).publish(any());
  }

  @Test
  void humanHumanMention_skipped() {
    dispatcher.onChatMessageCreated(event(HUMAN, List.of(HUMAN)));
    verify(client, never()).publish(any());
  }

  @Test
  void agentWithAgentMention_selfLoopBlocked() {
    dispatcher.onChatMessageCreated(event(AGENT, List.of(AGENT)));
    verify(client, never()).publish(any());
  }

  @Test
  void disabled_skipped() {
    when(props.enabled()).thenReturn(false);
    dispatcher.onChatMessageCreated(event(HUMAN, List.of(AGENT)));
    verify(client, never()).publish(any());
  }

  // ---- WP-371: 외부(EXTERNAL) 에이전트 멘션은 서버 이벤트 대상에서 제외 ----

  private static final UserSummary EXTERNAL_AGENT =
      new UserSummary(77L, "ext-bot", "External Bot", "AGENT");

  @Test
  void externalOnlyMention_skipped() {
    dispatcher.onChatMessageCreated(event(HUMAN, List.of(EXTERNAL_AGENT)));
    verify(client, never()).publish(any());
  }

  @Test
  void mixedMention_publishesWithInternalActingAgentId() {
    dispatcher.onChatMessageCreated(event(HUMAN, List.of(EXTERNAL_AGENT, AGENT)));
    ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, times(1)).publish(captor.capture());
    var payload = captor.getValue().payload();
    assertThat(payload.get("actingAgentId")).isEqualTo(AGENT.id());
    assertThat((List<?>) payload.get("mentions")).hasSize(2);
  }
}
