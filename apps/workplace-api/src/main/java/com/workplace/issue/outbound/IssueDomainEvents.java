package com.workplace.issue.outbound;

import com.workplace.global.dto.UserSummary;
import java.time.Instant;
import java.util.List;

/**
 * 이슈 도메인 이벤트 4종. ApplicationEventPublisher 로 발행되어 AFTER_COMMIT 단계에서 dispatcher 가 받는다. assignees 는
 * 변경 후 현재 상태.
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
      Instant occurredAt) {}

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
      Instant occurredAt) {}
}
