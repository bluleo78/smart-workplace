package com.workplace.issue.workflow.dto;

import com.workplace.global.dto.UserSummary;
import java.time.Instant;
import java.util.List;

/**
 * 정의의 실행 목록 한 쪽(WP-1985, {@code GET /workflows/{id}/runs}).
 *
 * @param items 최신순 실행(id 내림차순)
 * @param nextCursor 다음 쪽을 읽을 cursor(마지막 쪽이면 null)
 */
public record WorkflowRunPage(List<Item> items, String nextCursor) {

  /**
   * 실행 한 줄(설계 §11). 머문 시간은 받는 쪽이 {@code enteredAt} 으로 계산한다.
   *
   * @param issueKey 「프로젝트 키-번호」
   * @param currentNode 지금 노드 키(끝났으면 end 노드)
   * @param currentNodeName 그 노드의 이름(실행이 고정한 버전 모델 기준, 없으면 null)
   * @param assignees 지금 노드 방문의 담당
   * @param enteredAt 지금 노드에 들어간 시각
   * @param versionNo 실행이 고정한 게시 번호
   */
  public record Item(
      long runId,
      long issueId,
      String issueKey,
      String title,
      String status,
      String currentNode,
      String currentNodeName,
      List<UserSummary> assignees,
      Instant enteredAt,
      Instant startedAt,
      int versionNo) {}
}
