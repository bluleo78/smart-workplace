package com.workplace.issue.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.workplace.global.ai.SharedAiMemoryReader;
import com.workplace.global.ai.SharedMemories;
import com.workplace.global.ai.SharedMemoryLine;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.EventEnvelope;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.user.service.ServerAgentResolver;
import java.time.Instant;
import java.util.List;
import java.util.Set;
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
  private ServerAgentResolver resolver;
  private SharedAiMemoryReader sharedReader;
  private IssueEventDispatcher dispatcher;

  @BeforeEach
  void setUp() {
    client = Mockito.mock(AiAgentEventClient.class);
    resolver = Mockito.mock(ServerAgentResolver.class);
    sharedReader = Mockito.mock(SharedAiMemoryReader.class);
    // 기본: 모든 AGENT 담당자를 내부(INTERNAL) 실행으로 취급 — 외부 케이스는 internalAgents(...) 로 따로 지정.
    internalAgents(AGENT_ASSIGNEE.id());
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

  private IssueEventDispatcher build(boolean enabled) {
    var props = new AiAgentProperties("http://ai-agent", "tok", enabled);
    return new IssueEventDispatcher(client, props, resolver, sharedReader);
  }

  /** WP-386: 이슈 이벤트에 조직 + 그 프로젝트 공용 메모리를 싣는다(대행 에이전트 권한으로 리더가 고른다). */
  @Test
  void 공용_메모리를_payload_에_싣는다() {
    dispatcher = build(true);
    var shared =
        new SharedMemories(List.of(new SharedMemoryLine("WP 프로젝트(WP)", "배포는 API 먼저 한다")), 1);
    when(sharedReader.readForProjectAgent("WP", AGENT_ASSIGNEE.id())).thenReturn(shared);
    dispatcher.onIssueAssigned(
        new IssueAssignedEvent(
            42L,
            "WP",
            "WP-42",
            "분석",
            HUMAN_ACTOR,
            List.of(AGENT_ASSIGNEE),
            List.of(AGENT_ASSIGNEE),
            List.of(),
            Instant.parse("2026-05-25T12:00:00Z")));
    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client).publish(captor.capture());
    assertThat(captor.getValue().payload()).containsEntry("sharedMemories", shared.items());
    assertThat(captor.getValue().payload()).containsEntry("sharedMemoryMoreCount", 1);
  }

  /** WP-386: 리더가 비면 빈 목록(null 아님). */
  @Test
  void 공용_메모리가_없으면_빈_목록() {
    dispatcher = build(true);
    dispatcher.onIssueAssigned(
        new IssueAssignedEvent(
            42L,
            "WP",
            "WP-42",
            "분석",
            HUMAN_ACTOR,
            List.of(AGENT_ASSIGNEE),
            List.of(AGENT_ASSIGNEE),
            List.of(),
            Instant.parse("2026-05-25T12:00:00Z")));
    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client).publish(captor.capture());
    assertThat(captor.getValue().payload()).containsEntry("sharedMemories", List.of());
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

  /** 비활성·self-loop 은 대행 에이전트 조회(DB) 없이 거른다. */
  @Test
  void 비활성이나_self_loop_이면_resolver_를_부르지_않는다() {
    var as = List.of(AGENT_ASSIGNEE);
    var now = Instant.now();

    build(false)
        .onIssueAssigned(
            new IssueAssignedEvent(1L, "WP", "WP-1", "t", HUMAN_ACTOR, as, as, List.of(), now));
    build(true)
        .onIssueCommented(
            new IssueCommentedEvent(1L, "WP", "WP-1", 1, "t", AGENT_ACTOR, as, 9L, "hi", now));

    verifyNoInteractions(resolver);
    verify(client, never()).publish(Mockito.any());
  }

  // ---- WP-371: 외부(EXTERNAL) 에이전트는 서버 이벤트 대상에서 제외 ----

  private static final UserSummary EXTERNAL_AGENT =
      new UserSummary(301L, "ext-bot", "External Bot", "AGENT");

  /** EXTERNAL AGENT 만 담당자면 3종 이벤트 모두 ai-agent 로 보내지 않는다. */
  @Test
  void EXTERNAL_AGENT_만_담당이면_3종_모두_skip() {
    dispatcher = build(true);
    internalAgents(); // 내부 에이전트 없음
    var as = List.of(EXTERNAL_AGENT);
    var now = Instant.now();

    dispatcher.onIssueAssigned(
        new IssueAssignedEvent(1L, "WP", "WP-1", "t", HUMAN_ACTOR, as, as, List.of(), now));
    dispatcher.onIssueCommented(
        new IssueCommentedEvent(1L, "WP", "WP-1", 1, "t", HUMAN_ACTOR, as, 9L, "hi", now));
    dispatcher.onIssueStatusChanged(
        new IssueStatusChangedEvent(1L, "WP", "WP-1", "t", HUMAN_ACTOR, as, "TODO", "DONE", now));

    verify(client, never()).publish(Mockito.any());
  }

  /** INTERNAL+EXTERNAL 혼합이면 발사하고 actingAgentId 는 첫 INTERNAL AGENT, assignees 는 전원 유지. */
  @Test
  void 혼합_담당이면_발사하고_actingAgentId_는_내부_에이전트() {
    dispatcher = build(true);
    var as = List.of(EXTERNAL_AGENT, AGENT_ASSIGNEE, HUMAN_ASSIGNEE);
    var event =
        new IssueCommentedEvent(1L, "WP", "WP-1", 1, "t", HUMAN_ACTOR, as, 9L, "hi", Instant.now());

    dispatcher.onIssueCommented(event);

    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, times(1)).publish(captor.capture());
    var payload = captor.getValue().payload();
    assertThat(payload).containsEntry("actingAgentId", AGENT_ASSIGNEE.id());
    assertThat((List<?>) payload.get("assignees")).hasSize(3);
  }
}
