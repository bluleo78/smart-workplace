package com.workplace.issue.workflow.dto;

import com.workplace.global.dto.UserSummary;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * 이슈의 워크플로우 실행 모습(WP-1985) — {@code GET /issues/{id}/workflow}·시작·이동의 응답이고, 이동의 멱등 재응답으로 그대로 저장된다.
 *
 * <p>실행이 없으면 runId·status·workflowId·versionNo·currentNode 가 null 이고 목록은 비어 있다. 끝난 실행은 outcomes 가 빈
 * 목록이다(설계 §11).
 *
 * @param runId 실행 id(dryRun·실행 없음이면 null)
 * @param status 실행 상태(RUNNING·WAITING·SUSPENDED·COMPLETED·CANCELED)
 * @param revision 이동 요청의 expectedRevision 으로 보낼 값
 * @param workflowId 정의 id
 * @param versionNo 실행이 고정한 게시 번호
 * @param currentNode 지금 노드
 * @param outcomes 지금 노드에서 고를 수 있는 결과
 * @param path 지나온 노드(들어간 순서, 지금 노드 제외)
 * @param remainingNodeKeys end 까지 남은 기본 경로(질문 경로 제외, 지금 노드 제외)
 * @param context 실행 context(노드 키 → 출력, 예약 키 {@code _qa})
 * @param endedAt 실행이 끝난 시각(진행 중·실행 없음이면 null) — 웹이 취소 시각을 이력에 쓴다
 */
public record IssueWorkflowView(
    Long runId,
    String status,
    int revision,
    Long workflowId,
    Integer versionNo,
    NodeView currentNode,
    List<OutcomeView> outcomes,
    List<NodeRunSummary> path,
    List<String> remainingNodeKeys,
    Map<String, Object> context,
    Instant endedAt) {

  /** 실행이 하나도 없는 이슈의 view. */
  public static IssueWorkflowView none() {
    return new IssueWorkflowView(
        null, null, 0, null, null, null, List.of(), List.of(), List.of(), Map.of(), null);
  }

  /**
   * 지금 노드.
   *
   * @param assignees 지금 node_run 의 담당
   * @param nodeRunStatus 지금 node_run 의 상태(ACTIVE·BLOCKED·COMPLETED·FAILED)
   * @param instructions 게시본의 지시(펼친 값)
   */
  public record NodeView(
      String key,
      String name,
      String type,
      String roleKey,
      List<UserSummary> assignees,
      Instant enteredAt,
      String nodeRunStatus,
      String instructions) {}

  /**
   * 고를 수 있는 결과 하나.
   *
   * @param requiredOutputs 꼭 내놓아야 할 값(질문 결과는 빈 목록)
   * @param candidateAssignees 다음 담당 후보
   * @param assigneeRequired assigneeIds 가 필요한지 — decision 을 지나 목적을 미리 모르면 null
   */
  public record OutcomeView(
      String key,
      String toNode,
      List<RequiredOutput> requiredOutputs,
      boolean requireComment,
      String assignTo,
      List<UserSummary> candidateAssignees,
      Boolean assigneeRequired) {}

  /** 꼭 내놓아야 할 값의 키·형식. */
  public record RequiredOutput(String key, String type) {}

  /**
   * 지나온 노드 하나.
   *
   * @param outcome 나간 결과(자동 노드는 null)
   * @param actor 나가게 한 사람(자동 노드는 null)
   */
  public record NodeRunSummary(
      String key,
      String name,
      String outcome,
      UserSummary actor,
      Instant enteredAt,
      Instant leftAt) {}
}
