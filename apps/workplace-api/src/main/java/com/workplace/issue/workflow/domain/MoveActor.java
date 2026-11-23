package com.workplace.issue.workflow.domain;

/**
 * 이동을 요청한 사람.
 *
 * @param id 사용자 id
 * @param manager 프로젝트 관리자(project:manage + OWNER, 정의 편집과 같은 기준)인지 — 서비스가 권한으로 정한다
 */
public record MoveActor(long id, boolean manager) {

  /**
   * 지금 노드의 담당인지 — node_run 담당에 있고 <b>지금도 이슈 담당</b>이어야 한다.
   *
   * <p>왜: 사람이 이슈에서 뺀 AI 가 node_run 에 남은 이름으로 계속 넘기지 못하게 한다(설계 §5).
   */
  public boolean isAssignee(RunState state) {
    return state.nodeAssignees().contains(id) && state.issueAssignees().contains(id);
  }

  /** 담당이 아닌 관리자가 넘기는지 — 이때만 이벤트에 {@code override: true} 로 남긴다. */
  public boolean isOverride(RunState state) {
    return manager && !isAssignee(state);
  }
}
