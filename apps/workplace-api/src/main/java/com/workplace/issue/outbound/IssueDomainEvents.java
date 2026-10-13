package com.workplace.issue.outbound;

import com.workplace.global.dto.UserSummary;
import java.time.Instant;
import java.util.List;
import java.util.Set;

/**
 * 이슈 도메인 이벤트 5종. ApplicationEventPublisher 로 발행되어 AFTER_COMMIT 단계에서 dispatcher 가 받는다. assignees 는
 * 변경 후 현재 상태.
 *
 * <p>WP-371: 담당 지정·코멘트·상태 전이 이벤트는 {@code internalAgentIds} 를 함께 싣는다 — assignees 중 서버(ai-agent)가 대신
 * 실행하는 (kind=AGENT, runtime=INTERNAL) 에이전트의 id 집합. dispatcher 는 AFTER_COMMIT @Async 로 DB 를 읽지 않으므로,
 * 외부(EXTERNAL) 에이전트를 거르는 근거를 원 트랜잭션 안에서 발행 시점에 미리 채워 둔다. 필수 non-null 이며 dispatcher 는 이를 권위 있는 값으로
 * 쓴다(빈 집합 = 내부 에이전트 없음). null 로 두면 fail-open 이 되므로 호환 생성자를 두지 않는다.
 */
public final class IssueDomainEvents {
  private IssueDomainEvents() {}

  /** 이슈 생성 직후. assignees 가 비어있을 수도 있음. */
  public record IssueCreatedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      String status,
      String priority,
      UserSummary actor,
      List<UserSummary> assignees,
      Instant occurredAt) {}

  /** assignee 집합 변경. added/removed 는 diff. */
  public record IssueAssignedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      List<UserSummary> added,
      List<UserSummary> removed,
      Instant occurredAt,
      Set<Long> internalAgentIds) {
    // fail-open 방지: null 은 허용하지 않는다(내부 에이전트가 없으면 빈 집합).
    public IssueAssignedEvent {
      java.util.Objects.requireNonNull(internalAgentIds, "internalAgentIds");
    }
  }

  /**
   * 코멘트 추가. commentBody 는 agent 응답 트리거의 핵심 컨텍스트라 포함. issueNumber 는 SSE 브로드캐스트(#579)가 프론트
   * 쿼리키(issueKeys.detail(projectKey, number))를 그대로 구성하는 데 필요 — issueKey 문자열 파싱을 피한다.
   */
  public record IssueCommentedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      int issueNumber,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      long commentId,
      String commentBody,
      Instant occurredAt,
      Set<Long> internalAgentIds) {
    // fail-open 방지: null 은 허용하지 않는다(내부 에이전트가 없으면 빈 집합).
    public IssueCommentedEvent {
      java.util.Objects.requireNonNull(internalAgentIds, "internalAgentIds");
    }
  }

  /** 코멘트 수정 (#717). commentBody 는 수정된(새) 본문. */
  public record IssueCommentUpdatedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      int issueNumber,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      long commentId,
      String commentBody,
      Instant occurredAt) {}

  /** 코멘트 soft-delete (#717). */
  public record IssueCommentDeletedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      int issueNumber,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      long commentId,
      Instant occurredAt) {}

  /** 상태 전이 (예: TODO → IN_PROGRESS). */
  public record IssueStatusChangedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      String previousStatus,
      String newStatus,
      Instant occurredAt,
      Set<Long> internalAgentIds) {
    // fail-open 방지: null 은 허용하지 않는다(내부 에이전트가 없으면 빈 집합).
    public IssueStatusChangedEvent {
      java.util.Objects.requireNonNull(internalAgentIds, "internalAgentIds");
    }
  }

  /** 우선순위 변경 (예: MEDIUM → HIGH). 상태 변경과 대칭적으로 모든 변경에 발행(임계치 조건 없음, #613). */
  public record IssuePriorityChangedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      String previousPriority,
      String newPriority,
      Instant occurredAt) {}
}
