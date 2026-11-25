package com.workplace.issue.workflow.domain;

/**
 * 이동을 요청한 사람.
 *
 * @param id 사용자 id
 * @param manager 프로젝트 관리자(project:manage + OWNER, 정의 편집과 같은 기준)인지 — 서비스가 권한으로 정한다
 * @param chatAnswer 질문 대기 노드에 사람이 이슈 챗으로 단 답을 answered 이동으로 옮기는지(WP-2093). 챗 질문의 답은 담당이 아니어도 구성원
 *     누구나 할 수 있어(워크플로우 없는 AI 작업의 챗 질문 규칙과 같게) 담당 검사만 통과시킨다. 관리자 대리가 아니라 override 로 적지 않는다
 */
public record MoveActor(long id, boolean manager, boolean chatAnswer) {

  /** 화면·도구의 일반 이동 행위자 — 챗 답이 아니다. */
  public MoveActor(long id, boolean manager) {
    this(id, manager, false);
  }

  /** 이슈 챗 답 글이 질문 대기 노드를 옮기는 행위자(WP-2093) — 관리자 대리가 아니고 담당 검사만 건너뛴다. */
  public static MoveActor chatAnswer(long id) {
    return new MoveActor(id, false, true);
  }

  /**
   * 지금 노드의 담당인지 — node_run 담당에 있고 <b>지금도 이슈 담당</b>이어야 한다.
   *
   * <p>왜: 사람이 이슈에서 뺀 AI 가 node_run 에 남은 이름으로 계속 넘기지 못하게 한다(설계 §5).
   */
  public boolean isAssignee(RunState state) {
    return state.nodeAssignees().contains(id) && state.issueAssignees().contains(id);
  }

  /** 담당 검사를 통과하는지 — 지금 노드 담당이거나 관리자이거나 챗 답(WP-2093)이다. */
  public boolean mayMove(RunState state) {
    return chatAnswer || manager || isAssignee(state);
  }

  /** 담당이 아닌 관리자가 넘기는지 — 이때만 이벤트에 {@code override: true} 로 남긴다. 챗 답은 관리자 대리가 아니라 넣지 않는다. */
  public boolean isOverride(RunState state) {
    return manager && !chatAnswer && !isAssignee(state);
  }
}
