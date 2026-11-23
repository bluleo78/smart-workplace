package com.workplace.issue.workflow.dto;

import com.fasterxml.jackson.annotation.JsonRawValue;
import com.workplace.global.dto.UserSummary;
import java.time.Instant;
import java.util.List;

/**
 * 실행 한 건의 상세(WP-1985, {@code GET /workflow-runs/{runId}}) — 실행·모든 노드 방문·이벤트와 실행이 고정한 버전의 모델.
 *
 * @param model 버전 조회({@code GET /workflows/{id}/versions/{no}})의 model 과 같은 저장 JSON 글 그대로 — 다시 읽고
 *     쓰면 수·순서가 달라질 수 있어 해석하지 않는다
 */
public record WorkflowRunDetail(
    Run run, List<NodeRunItem> nodeRuns, List<EventItem> events, @JsonRawValue String model) {

  /**
   * 실행.
   *
   * @param revision 이동 요청의 expectedRevision 으로 보낼 값
   * @param startedBy 시작한 사람(없어졌으면 null)
   * @param endedAt 끝난 시각(진행 중이면 null)
   * @param context 실행 context JSON 글 그대로(노드 키 → 출력, 예약 키 {@code _qa})
   */
  public record Run(
      long runId,
      long workflowId,
      int versionNo,
      long issueId,
      String issueKey,
      String title,
      String status,
      int revision,
      String currentNode,
      UserSummary startedBy,
      Instant startedAt,
      Instant endedAt,
      @JsonRawValue String context) {}

  /**
   * 노드 방문 하나(들어간 순서).
   *
   * @param nodeName 그 버전 모델의 노드 이름(없으면 null)
   * @param assignees 이 방문의 담당
   * @param workflowAssigned 그중 워크플로우가 이슈 담당에 넣은 사람
   * @param outputs 낸 출력 JSON 글(없으면 null)
   * @param commentId 이동에 남긴 의견 댓글 id
   * @param actor 방문을 마치게 한 사람(자동 노드·없어졌으면 null)
   * @param viaReturn 되돌림 간선으로 들어온 방문인지
   */
  public record NodeRunItem(
      long id,
      String nodeKey,
      String nodeName,
      int visitNo,
      String status,
      List<UserSummary> assignees,
      List<UserSummary> workflowAssigned,
      String outcome,
      @JsonRawValue String outputs,
      Long commentId,
      String waitingReason,
      String error,
      UserSummary actor,
      Instant enteredAt,
      Instant leftAt,
      boolean viaReturn) {}

  /**
   * 실행 이벤트 하나(일어난 순서).
   *
   * @param payload 이벤트 내용 JSON 글 그대로
   * @param actor 일으킨 사람(시스템이면 null)
   */
  public record EventItem(
      long id, String type, @JsonRawValue String payload, UserSummary actor, Instant at) {}
}
