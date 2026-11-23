package com.workplace.issue.outbound;

import java.util.List;
import java.util.Set;

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
   * @param actorId 진입을 일으킨 사람(시작·이동·조치의 요청자 — 자동 통과도 그 요청의 사람). AI 깨우기 이벤트의 행위자로 쓴다(WP-1986)
   * @param alreadyNotifiedIds 이번 시작·이동의 담당 변경으로 이미 ASSIGNED 알림을 받은 사람(새로 넣은 담당) — 깨우기 알림을 또 보내지 않게
   *     깨우기 이벤트로 넘긴다(WP-1986)
   */
  public record WorkflowNodeEntered(
      long tenantId,
      long runId,
      long issueId,
      String nodeKey,
      String nodeType,
      List<Long> assigneeIds,
      Long actorId,
      Set<Long> alreadyNotifiedIds) {
    /** 목록을 불변으로(null 은 빈 집합). */
    public WorkflowNodeEntered {
      assigneeIds = List.copyOf(assigneeIds);
      alreadyNotifiedIds = alreadyNotifiedIds == null ? Set.of() : Set.copyOf(alreadyNotifiedIds);
    }
  }

  /**
   * 워크플로우가 노드의 AI 를 깨운다(WP-1986) — {@code WorkflowAgentWorkBridge} 가 agent_task 진입 때 쓰기 트랜잭션 안에서
   * 발행하고, 커밋 뒤 소비자가 깨운다: 내부 AI 는 그 AI 를 실행 주체로 고정한 ai-agent issue.assigned 발사, 그 밖(외부 AI)은 ASSIGNED
   * 알림.
   *
   * <p>왜 담당 지정 이벤트를 다시 쓰지 않나: 담당 지정 발사는 행위자가 AI 면 건너뛰고(self-loop 차단) 이슈 담당 중 첫 내부 AI 를 고른다 — AI 가
   * 다음 노드의 AI 에게 넘기는 워크플로우에서는 깨워야 할 AI 를 못 깨우거나 다른 AI 를 깨운다. 또 이동이 새로 넣은 AI 는 담당 변경 이벤트로 이미
   * ASSIGNED 알림을 받으므로 같은 알림이 두 번 갔다.
   *
   * @param agentIds 깨울 노드의 AI(내부·외부)
   * @param alreadyNotifiedIds 이번 시작·이동의 담당 변경으로 이미 ASSIGNED 알림을 받은 사람 — 알림 소비자가 뺀다
   * @param actorId 진입을 일으킨 사람(AI 일 수 있다)
   */
  public record WorkflowNodeWakeEvent(
      long tenantId,
      long issueId,
      long runId,
      String nodeKey,
      List<Long> agentIds,
      Set<Long> alreadyNotifiedIds,
      Long actorId) {
    /** 목록을 불변으로(null 은 빈 집합). */
    public WorkflowNodeWakeEvent {
      agentIds = List.copyOf(agentIds);
      alreadyNotifiedIds = alreadyNotifiedIds == null ? Set.of() : Set.copyOf(alreadyNotifiedIds);
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
