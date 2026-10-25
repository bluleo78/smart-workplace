package com.workplace.issue.outbound;

import com.workplace.global.dto.UserSummary;
import java.time.Instant;
import java.util.List;

/**
 * 이슈 도메인 이벤트 5종. ApplicationEventPublisher 로 발행되어 AFTER_COMMIT 단계에서 dispatcher 가 받는다. assignees 는
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

  /** 보고자 변경(WP-944). from 은 이전 보고자(사용자 행이 없으면 null), to 는 새 보고자. */
  public record IssueReporterChangedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      UserSummary from,
      UserSummary to,
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

  /**
   * 코멘트 반응 추가·취소(WP-504). 실시간 재조회 신호 전용 — 알림·ai-agent 발사·AI 요약 갱신 대상이 아니다(반응은 알림을 만들지 않는다). 무엇이
   * 바뀌었는지는 싣지 않는다: 받는 쪽은 코멘트 목록을 다시 받아 보는 사람별 reacted 를 얻는다.
   */
  public record IssueCommentReactionsChangedEvent(
      Long issueId,
      String issueKey,
      String projectKey,
      int issueNumber,
      Long commentId,
      Long actorId) {}

  /**
   * 상태 전이 (예: TODO → IN_PROGRESS). previousStatus·newStatus 는 범주, previousStatusName·newStatusName
   * 은 사람이 읽는 프로젝트 상태 이름(WP-807). 같은 범주 안 이동(진행 중 → 검토 중)도 발행되며 그때는 범주가 같다.
   */
  public record IssueStatusChangedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      String previousStatus,
      String newStatus,
      String previousStatusName,
      String newStatusName,
      Instant occurredAt) {}

  /** 우선순위 변경 (예: MID → HIGHEST). 상태 변경과 대칭적으로 모든 변경에 발행(임계치 조건 없음, #613). */
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
