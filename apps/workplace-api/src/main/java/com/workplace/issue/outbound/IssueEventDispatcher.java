package com.workplace.issue.outbound;

import com.workplace.global.ai.SharedAiMemoryReader;
import com.workplace.global.ai.SharedMemories;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.EventEnvelope;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.user.dto.UserKind;
import com.workplace.user.service.ServerAgentResolver;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 도메인 이벤트 → ai-agent 발사. AFTER_COMMIT 에서만 동작 — 트랜잭션 롤백 시 발사하지 않는다. 모든 핸들러는 enabled / self-loop / 서버
 * 실행(INTERNAL) AGENT 담당자 필터를 거친 뒤 envelope 을 만들어 client 에 위임한다. 핸들러는 @Async("aiAgentEventExecutor")
 * 로 별도 스레드에서 실행되어 ai-agent 다운 시의 재시도 백오프가 도메인 처리(호출 스레드)에 영향을 주지 않는다.
 *
 * <p>WP-253: IssueCreatedEvent 는 발사하지 않는다. 담당자를 지정한 생성은 IssueAssignedEvent(added=전원)도 함께 발행되므로 둘 다
 * 발사하면 AI 가 2회 실행된다 — 트리거는 "담당 지정" 하나로 통일. (ai-agent 는 롤링 배포 호환을 위해 issue.created 수신을 유지한다.)
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IssueEventDispatcher {

  private final AiAgentEventClient client;
  private final AiAgentProperties props;
  private final ServerAgentResolver agentResolver;

  /** WP-386: 이슈 AI 담당자 이벤트에 싣는 공용 메모리 리더(조직 + 이 프로젝트). */
  private final SharedAiMemoryReader sharedReader;

  @Async("aiAgentEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueAssigned(IssueAssignedEvent e) {
    Long actingAgentId = actingAgentOrSkip(e.actor(), e.assignees());
    if (actingAgentId == null) return;
    Map<String, Object> p =
        baseFields(
            e.issueId(),
            e.projectKey(),
            e.issueKey(),
            e.title(),
            e.actor(),
            e.assignees(),
            e.occurredAt(),
            actingAgentId);
    p.put("added", e.added().stream().map(IssueEventDispatcher::summary).toList());
    p.put("removed", e.removed().stream().map(IssueEventDispatcher::summary).toList());
    dispatch("issue.assigned", p, e.issueKey());
  }

  @Async("aiAgentEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueCommented(IssueCommentedEvent e) {
    Long actingAgentId = actingAgentOrSkip(e.actor(), e.assignees());
    if (actingAgentId == null) return;
    Map<String, Object> p =
        baseFields(
            e.issueId(),
            e.projectKey(),
            e.issueKey(),
            e.title(),
            e.actor(),
            e.assignees(),
            e.occurredAt(),
            actingAgentId);
    p.put("commentId", e.commentId());
    p.put("commentBody", e.commentBody());
    dispatch("issue.commented", p, e.issueKey());
  }

  @Async("aiAgentEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueStatusChanged(IssueStatusChangedEvent e) {
    Long actingAgentId = actingAgentOrSkip(e.actor(), e.assignees());
    if (actingAgentId == null) return;
    Map<String, Object> p =
        baseFields(
            e.issueId(),
            e.projectKey(),
            e.issueKey(),
            e.title(),
            e.actor(),
            e.assignees(),
            e.occurredAt(),
            actingAgentId);
    p.put("previousStatus", e.previousStatus());
    p.put("newStatus", e.newStatus());
    dispatch("issue.status_changed", p, e.issueKey());
  }

  /**
   * 공통 필터 + 대행 에이전트 선택 — null 이면 발사 skip. 비활성·AGENT 가 일으킨 변경(self-loop)은 조회 없이 거르고, 그 외엔 담당자 중 서버가
   * 실행할(INTERNAL) 첫 에이전트를 {@link ServerAgentResolver} 로 한 번 고른다. 사람만이거나 외부(EXTERNAL) 에이전트뿐이면 서버가 할
   * 일이 없으므로 null(WP-371).
   */
  private Long actingAgentOrSkip(UserSummary actor, List<UserSummary> assignees) {
    if (!props.enabled()) return null;
    if (actor != null && UserKind.isAgent(actor.kind())) return null; // self-loop 차단
    return agentResolver.pickActingAgent(assignees);
  }

  /** 공통 payload 필드 — 변경 가능한 HashMap 으로 추가 필드 합성 가능. */
  private Map<String, Object> baseFields(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      Instant occurredAt,
      Long actingAgentId) {
    Map<String, Object> p = new HashMap<>();
    p.put("projectKey", projectKey);
    p.put("issueKey", issueKey);
    p.put("issueId", issueId);
    p.put("issueTitle", title);
    p.put("actor", summary(actor));
    p.put("assignees", assignees.stream().map(IssueEventDispatcher::summary).toList());
    p.put("occurredAt", occurredAt.toString());
    // WP-371: 서버가 실행할 에이전트(첫 INTERNAL AGENT 담당자). ai-agent 는 이 id 로 실행 주체를 정한다.
    p.put("actingAgentId", actingAgentId);
    // WP-386: 조직 + 이 프로젝트 공용 메모리 — 대행 에이전트가 읽을 수 있는 TEAM·OPEN 프로젝트일 때만(PERSONAL 은 조직만).
    // 이 핸들러는 aiAgentEventExecutor(테넌트 전파) 스레드라 리더가 새 읽기 트랜잭션을 연다.
    SharedMemories shared =
        SharedMemories.orEmpty(sharedReader.readForProjectAgent(projectKey, actingAgentId));
    p.put("sharedMemories", shared.items());
    p.put("sharedMemoryMoreCount", shared.moreCount());
    return p;
  }

  /** UserSummary → 직렬화용 Map. record 직렬화 차이를 회피하기 위해 명시. */
  private static Map<String, Object> summary(UserSummary u) {
    if (u == null) return null;
    Map<String, Object> m = new HashMap<>();
    m.put("id", u.id());
    m.put("username", u.username());
    m.put("kind", u.kind());
    return m;
  }

  private void dispatch(String type, Map<String, Object> payload, String issueKey) {
    log.debug("[outbound] {} {} -> ai-agent", type, issueKey);
    client.publish(new EventEnvelope(type, payload));
  }
}
