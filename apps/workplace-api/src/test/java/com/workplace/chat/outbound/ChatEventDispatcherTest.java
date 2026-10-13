package com.workplace.chat.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.EventEnvelope;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

class ChatEventDispatcherTest {

  private AiAgentEventClient client;
  private AiAgentProperties props;
  private ChatEventDispatcher dispatcher;

  @BeforeEach
  void setUp() {
    client = Mockito.mock(AiAgentEventClient.class);
    props = Mockito.mock(AiAgentProperties.class);
    when(props.enabled()).thenReturn(true);
    dispatcher = new ChatEventDispatcher(client, props);
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
        Instant.now(),
        // 기본 헬퍼: 멘션된 AGENT 는 전부 내부 실행으로 취급(외부 케이스는 별도 테스트가 명시 전달).
        mentions.stream()
            .filter(m -> "AGENT".equals(m.kind()))
            .map(UserSummary::id)
            .collect(java.util.stream.Collectors.toSet()));
  }

  @Test
  void humanWithAgentMention_publishes() {
    dispatcher.onChatMessageCreated(event(HUMAN, List.of(AGENT)));
    ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, times(1)).publish(captor.capture());
    assertThat(captor.getValue().type()).isEqualTo("chat.message.posted");
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

  private ChatMessageCreatedEvent eventWithInternal(
      List<UserSummary> mentions, java.util.Set<Long> internalAgentIds) {
    return new ChatMessageCreatedEvent(
        1L,
        10L,
        100L,
        "WP",
        "WP-1",
        "t",
        "TODO",
        "b",
        HUMAN,
        "@x",
        mentions,
        List.of(),
        List.of(),
        Instant.now(),
        internalAgentIds);
  }

  @Test
  void externalOnlyMention_skipped() {
    dispatcher.onChatMessageCreated(eventWithInternal(List.of(EXTERNAL_AGENT), java.util.Set.of()));
    verify(client, never()).publish(any());
  }

  @Test
  void mixedMention_publishesWithInternalActingAgentId() {
    dispatcher.onChatMessageCreated(
        eventWithInternal(List.of(EXTERNAL_AGENT, AGENT), java.util.Set.of(AGENT.id())));
    ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, times(1)).publish(captor.capture());
    var payload = captor.getValue().payload();
    assertThat(payload.get("actingAgentId")).isEqualTo(AGENT.id());
    assertThat((List<?>) payload.get("mentions")).hasSize(2);
  }
}
