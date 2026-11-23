package com.workplace.issue.workflow.domain;

import com.workplace.issue.workflow.domain.WorkflowModel.Node;

/**
 * 워크플로우 노드 종류 이름(WP-1986). 실행·조치·AI 작업 다리·챗 답 재개가 같은 글자를 저마다 적지 않게 한곳에 둔다.
 *
 * <p>왜 {@link Node} 의 인스턴스 메서드가 아닌가: Node 는 모델 JSON 으로 직렬화되는 record 라 {@code isTask()} 같은 접근자가 칸으로
 * 새어 나갈 수 있다 — 정적 판정으로 둔다.
 */
public final class NodeTypes {

  /** 시작 노드 — 자동으로 지나간다. */
  public static final String START = "start";

  /** AI 가 맡아 머무는 노드. */
  public static final String AGENT_TASK = "agent_task";

  /** 사람이 맡아 머무는 노드(질문 답변 노드 포함). */
  public static final String HUMAN_TASK = "human_task";

  private NodeTypes() {}

  /** 사람·AI 가 머무는 노드인지(agent_task·human_task). */
  public static boolean isTask(Node node) {
    return AGENT_TASK.equals(node.type()) || HUMAN_TASK.equals(node.type());
  }
}
