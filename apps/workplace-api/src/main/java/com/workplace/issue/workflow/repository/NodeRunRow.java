package com.workplace.issue.workflow.repository;

import java.time.Instant;
import java.util.List;

/**
 * 노드 방문 한 행(node_run).
 *
 * @param assigneeIds 이 방문의 담당 사용자 id(순서 보존, 비면 빈 목록)
 * @param workflowAssignedIds 그중 워크플로우가 이슈 담당에 넣은 사용자 id
 * @param outputsJson 낸 출력 JSON 글(아직 나오지 않았으면 null)
 * @param commentId 이동에 남긴 의견 댓글 id(없으면 null)
 * @param actorId 방문을 마치게 한 사용자(없으면 null)
 * @param viaReturn 되돌림 간선으로 들어온 방문인지
 */
public record NodeRunRow(
    long id,
    long runId,
    String nodeKey,
    int visitNo,
    String status,
    List<Long> assigneeIds,
    List<Long> workflowAssignedIds,
    String outcome,
    String outputsJson,
    Long commentId,
    String waitingReason,
    String error,
    Instant enteredAt,
    Instant leftAt,
    Long actorId,
    boolean viaReturn) {

  /**
   * 그 노드 키의 가장 최근 방문(없으면 null) — 실행 view·AI 작업 다리·챗 답 재개가 같은 판정을 쓰게 한곳에 둔다(WP-1986). {@code
   * nodeKey} 가 null 이면 맞는 방문이 없어 null 이다.
   *
   * @param runs 들어간 순서의 노드 방문
   */
  public static NodeRunRow latestVisit(List<NodeRunRow> runs, String nodeKey) {
    for (int i = runs.size() - 1; i >= 0; i--) {
      if (runs.get(i).nodeKey().equals(nodeKey)) {
        return runs.get(i);
      }
    }
    return null;
  }
}
