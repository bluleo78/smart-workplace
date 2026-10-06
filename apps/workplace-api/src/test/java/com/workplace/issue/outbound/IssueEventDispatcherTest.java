package com.workplace.issue.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.EventEnvelope;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

/** IssueEventDispatcher — 필터·envelope 빌드 검증. Spring 컨텍스트 없이 직접 호출. */
class IssueEventDispatcherTest {

  private static final UserSummary HUMAN_ACTOR = new UserSummary(1L, "alice", "Alice", "HUMAN");
  private static final UserSummary AGENT_ACTOR = new UserSummary(201L, "ai-bot", "AI Bot", "AGENT");
  private static final UserSummary AGENT_ASSIGNEE =
      new UserSummary(201L, "ai-bot", "AI Bot", "AGENT");
  private static final UserSummary HUMAN_ASSIGNEE = new UserSummary(2L, "bob", "Bob", "HUMAN");

  private AiAgentEventClient client;
  private IssueEventDispatcher dispatcher;

  @BeforeEach
  void setUp() {
    client = Mockito.mock(AiAgentEventClient.class);
  }

  private IssueEventDispatcher build(boolean enabled) {
    var props = new AiAgentProperties("http://ai-agent", "tok", enabled);
    return new IssueEventDispatcher(client, props);
  }

  @Test
  void AGENT_assignee_없음_skip() {
    dispatcher = build(true);
    var event =
        new IssueAssignedEvent(
            1L,
            "WP",
            "WP-1",
            "t",
            HUMAN_ACTOR,
            List.of(HUMAN_ASSIGNEE),
            List.of(HUMAN_ASSIGNEE),
            List.of(),
            Instant.now());

    dispatcher.onIssueAssigned(event);

    verify(client, never()).publish(Mockito.any());
  }

  @Test
  void AGENT_assignee_있음_actor_HUMAN_발사() {
    dispatcher = build(true);
    var event =
        new IssueAssignedEvent(
            42L,
            "WP",
            "WP-42",
            "분석",
            HUMAN_ACTOR,
            List.of(AGENT_ASSIGNEE),
            List.of(AGENT_ASSIGNEE),
            List.of(),
            Instant.parse("2026-05-25T12:00:00Z"));

    dispatcher.onIssueAssigned(event);

    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, times(1)).publish(captor.capture());
    var env = captor.getValue();
    assertThat(env.type()).isEqualTo("issue.assigned");
    assertThat(env.payload()).containsEntry("issueKey", "WP-42");
    assertThat(env.payload()).containsEntry("issueId", 42L);
    assertThat(env.payload()).containsEntry("issueTitle", "분석");
    assertThat(env.payload()).containsKeys("added", "removed");
  }

  @Test
  void actor_AGENT_self_loop_skip() {
    dispatcher = build(true);
    var event =
        new IssueCommentedEvent(
            1L,
            "WP",
            "WP-1",
            1,
            "t",
            AGENT_ACTOR,
            List.of(AGENT_ASSIGNEE),
            99L,
            "스스로 단 코멘트",
            Instant.now());

    dispatcher.onIssueCommented(event);

    verify(client, never()).publish(Mockito.any());
  }

  @Test
  void enabled_false_skip() {
    dispatcher = build(false);
    var event =
        new IssueAssignedEvent(
            1L,
            "WP",
            "WP-1",
            "t",
            HUMAN_ACTOR,
            List.of(AGENT_ASSIGNEE),
            List.of(AGENT_ASSIGNEE),
            List.of(),
            Instant.now());

    dispatcher.onIssueAssigned(event);

    verify(client, never()).publish(Mockito.any());
  }

  /** WP-253: issue.created 는 발사하지 않는다(AI 실행 트리거는 issue.assigned 로 통일) — 나머지 3종 type 문자열 검증. */
  @Test
  void 발사_3종_type_문자열_정확() {
    dispatcher = build(true);
    var common = List.of(AGENT_ASSIGNEE);
    var now = Instant.now();

    dispatcher.onIssueAssigned(
        new IssueAssignedEvent(1L, "WP", "WP-1", "t", HUMAN_ACTOR, common, common, List.of(), now));
    dispatcher.onIssueCommented(
        new IssueCommentedEvent(1L, "WP", "WP-1", 1, "t", HUMAN_ACTOR, common, 9L, "hi", now));
    dispatcher.onIssueStatusChanged(
        new IssueStatusChangedEvent(
            1L, "WP", "WP-1", "t", HUMAN_ACTOR, common, "TODO", "IN_PROGRESS", now));

    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, times(3)).publish(captor.capture());
    assertThat(captor.getAllValues())
        .extracting(EventEnvelope::type)
        .containsExactly("issue.assigned", "issue.commented", "issue.status_changed");
  }
}
