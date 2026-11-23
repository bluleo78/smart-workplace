package com.workplace.issue.workflow.domain;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 이동 판정에 필요한 실행의 지금 모습 — 서비스가 DB 에서 읽어 채운다.
 *
 * <p>왜: {@link MoveRules} 가 DB·Spring 없이 판정하려면 실행·이슈·node_run 에서 읽은 값을 한 값으로 받아야 한다. 목록·맵은 순서를 지킨
 * 불변 사본으로 굳힌다(null 원소·값이 있어도 터지지 않게 {@code copyOf} 를 쓰지 않는다).
 *
 * @param model 실행이 고정한 게시본 모델
 * @param status workflow_run.status
 * @param revision 실행의 revision
 * @param issueClosed 이슈가 닫혔는지
 * @param currentNode 지금 노드 키
 * @param nodeStatus 지금 node_run 의 status
 * @param nodeAssignees 지금 node_run 의 assignee_ids
 * @param issueAssignees 지금 이슈 담당(순서 유지 — start 의 매치 순서가 이 순서다)
 * @param lastAssigneesByNode 노드 키 → 그 노드의 가장 최근 node_run 담당(keep 기준). 지금 노드 자신으로 돌아가는 keep 이 있으면 지금
 *     노드의 담당도 들어 있어야 한다
 * @param context 실행 context(노드 키 → 출력 맵)
 */
public record RunState(
    WorkflowModel model,
    String status,
    int revision,
    boolean issueClosed,
    String currentNode,
    String nodeStatus,
    List<Long> nodeAssignees,
    Set<Long> issueAssignees,
    Map<String, List<Long>> lastAssigneesByNode,
    Map<String, Object> context) {

  /** 실행 status 값. */
  public static final String RUNNING = "RUNNING";

  public static final String WAITING = "WAITING";
  public static final String SUSPENDED = "SUSPENDED";
  public static final String COMPLETED = "COMPLETED";
  public static final String CANCELED = "CANCELED";

  /** node_run status 값. */
  public static final String NODE_ACTIVE = "ACTIVE";

  public static final String NODE_BLOCKED = "BLOCKED";
  public static final String NODE_FAILED = "FAILED";

  /** null 은 빈 값으로, 목록·맵은 순서를 지킨 불변 사본으로. */
  public RunState {
    nodeAssignees =
        nodeAssignees == null
            ? List.of()
            : Collections.unmodifiableList(new ArrayList<>(nodeAssignees));
    issueAssignees =
        issueAssignees == null
            ? Set.of()
            : Collections.unmodifiableSet(new LinkedHashSet<>(issueAssignees));
    lastAssigneesByNode = copyLastAssignees(lastAssigneesByNode);
    context =
        context == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(context));
  }

  /** 노드별 최근 담당을 바깥 맵·안쪽 목록 모두 불변 사본으로(호출자가 나중에 바꿔도 판정이 흔들리지 않게). null 목록은 빈 목록. */
  private static Map<String, List<Long>> copyLastAssignees(Map<String, List<Long>> source) {
    if (source == null) {
      return Map.of();
    }
    Map<String, List<Long>> copy = new LinkedHashMap<>();
    source.forEach(
        (node, ids) ->
            copy.put(
                node,
                ids == null ? List.of() : Collections.unmodifiableList(new ArrayList<>(ids))));
    return Collections.unmodifiableMap(copy);
  }

  /** 활성 실행인지(RUNNING·WAITING·SUSPENDED). */
  public boolean isActive() {
    return RUNNING.equals(status) || WAITING.equals(status) || SUSPENDED.equals(status);
  }

  /** 멈춘 상태라 이동할 수 없는지 — 실행 SUSPENDED 또는 node BLOCKED·FAILED(설계 §7 의 6). */
  public boolean isSuspended() {
    return SUSPENDED.equals(status)
        || NODE_BLOCKED.equals(nodeStatus)
        || NODE_FAILED.equals(nodeStatus);
  }
}
