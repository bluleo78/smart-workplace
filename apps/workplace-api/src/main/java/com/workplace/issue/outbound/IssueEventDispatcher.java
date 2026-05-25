package com.workplace.issue.outbound;

import com.workplace.issue.dto.UserSummary;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCreatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 도메인 이벤트 → ai-agent 발사. AFTER_COMMIT 에서만 동작 — 트랜잭션 롤백 시 발사하지 않는다. 모든 핸들러는 enabled / AGENT assignee
 * / self-loop 필터를 거친 뒤 envelope 을 만들어 client 에 위임한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IssueEventDispatcher {

  private final AiAgentEventClient client;
  private final AiAgentProperties props;

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueCreated(IssueCreatedEvent e) {
    if (skip(e.actor(), e.assignees())) return;
    Map<String, Object> p =
        baseFields(
            e.issueId(),
            e.projectKey(),
            e.issueKey(),
            e.title(),
            e.actor(),
            e.assignees(),
            e.occurredAt());
    p.put("status", e.status());
    p.put("priority", e.priority());
    dispatch("issue.created", p, e.issueKey());
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueAssigned(IssueAssignedEvent e) {
    if (skip(e.actor(), e.assignees())) return;
    Map<String, Object> p =
        baseFields(
            e.issueId(),
            e.projectKey(),
            e.issueKey(),
            e.title(),
            e.actor(),
            e.assignees(),
            e.occurredAt());
    p.put("added", e.added().stream().map(IssueEventDispatcher::summary).toList());
    p.put("removed", e.removed().stream().map(IssueEventDispatcher::summary).toList());
    dispatch("issue.assigned", p, e.issueKey());
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueCommented(IssueCommentedEvent e) {
    if (skip(e.actor(), e.assignees())) return;
    Map<String, Object> p =
        baseFields(
            e.issueId(),
            e.projectKey(),
            e.issueKey(),
            e.title(),
            e.actor(),
            e.assignees(),
            e.occurredAt());
    p.put("commentId", e.commentId());
    p.put("commentBody", e.commentBody());
    dispatch("issue.commented", p, e.issueKey());
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueStatusChanged(IssueStatusChangedEvent e) {
    if (skip(e.actor(), e.assignees())) return;
    Map<String, Object> p =
        baseFields(
            e.issueId(),
            e.projectKey(),
            e.issueKey(),
            e.title(),
            e.actor(),
            e.assignees(),
            e.occurredAt());
    p.put("previousStatus", e.previousStatus());
    p.put("newStatus", e.newStatus());
    dispatch("issue.status_changed", p, e.issueKey());
  }

  /** 공통 필터 — true 면 발사 skip. */
  private boolean skip(UserSummary actor, List<UserSummary> assignees) {
    if (!props.enabled()) return true;
    boolean hasAgent = assignees.stream().anyMatch(u -> "AGENT".equals(u.kind()));
    if (!hasAgent) return true;
    if (actor != null && "AGENT".equals(actor.kind())) return true; // self-loop 차단
    return false;
  }

  /** 공통 payload 필드 — 변경 가능한 HashMap 으로 추가 필드 합성 가능. */
  private Map<String, Object> baseFields(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      java.time.Instant occurredAt) {
    Map<String, Object> p = new HashMap<>();
    p.put("projectKey", projectKey);
    p.put("issueKey", issueKey);
    p.put("issueId", issueId);
    p.put("issueTitle", title);
    p.put("actor", summary(actor));
    p.put("assignees", assignees.stream().map(IssueEventDispatcher::summary).toList());
    p.put("occurredAt", occurredAt.toString());
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
