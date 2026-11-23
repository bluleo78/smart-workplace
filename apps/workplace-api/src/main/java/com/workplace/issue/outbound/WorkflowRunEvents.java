package com.workplace.issue.outbound;

import java.util.List;

/**
 * 워크플로우 실행 도메인 이벤트(WP-1985) — 실행 서비스가 쓰기 트랜잭션 안에서 발행하고, 구독자(알림·AI 깨우기·타이머)는 커밋 뒤에 처리한다.
 *
 * <p>왜 issue/outbound 인가: 알림 모듈은 이슈 모듈의 outbound 만 본다(원장 R2).
 */
public final class WorkflowRunEvents {

  private WorkflowRunEvents() {}

  /**
   * 실행이 머무는 노드(agent_task·human_task)에 들어갔다. 자동 노드(start·decision)와 end 에는 내지 않는다.
   *
   * @param assigneeIds 그 노드의 담당
   */
  public record WorkflowNodeEntered(
      long tenantId,
      long runId,
      long issueId,
      String nodeKey,
      String nodeType,
      List<Long> assigneeIds) {
    /** 담당 목록을 불변으로. */
    public WorkflowNodeEntered {
      assigneeIds = List.copyOf(assigneeIds);
    }
  }

  /**
   * 실행이 끝났다.
   *
   * @param status 끝난 상태(COMPLETED·CANCELED)
   */
  public record WorkflowRunEnded(long tenantId, long runId, long issueId, String status) {}

  /**
   * 되돌림이 아닌 방문 수가 노드의 maxVisits 이상이 되는 진입 — 이동은 그대로 하고 사람에게 알린다(설계 §10).
   *
   * @param visits 되돌림을 뺀 방문 수(이번 진입 포함)
   * @param actorId 이동을 일으킨 사람(알림에서 뺀다)
   */
  public record WorkflowVisitLimitReached(
      long tenantId, long runId, long issueId, String nodeKey, int visits, long actorId) {}
}
