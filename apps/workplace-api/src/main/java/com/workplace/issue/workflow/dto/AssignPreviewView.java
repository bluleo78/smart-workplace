package com.workplace.issue.workflow.dto;

import java.util.List;

/**
 * 담당 지정 미리보기 응답(WP-2120).
 *
 * @param start 이 담당으로 시작될 워크플로우(없으면 null)
 * @param blocked 시작될 워크플로우가 있지만 배정 규칙 위반으로 시작이 실패해 저장도 거절될 때의 이유(아니면 null)
 * @param active 이슈에 진행 중인 실행이 있는가 — 있으면 새로 더한 AI 가 일하지 않는 이유는 시작 조건이 아니다
 * @param startRoles 켜져 있고 게시된 정의들의 시작 조건 역할 — 시작하지 않을 때의 안내용
 */
public record AssignPreviewView(
    Start start, Blocked blocked, boolean active, List<String> startRoles) {

  /**
   * 시작될 워크플로우.
   *
   * @param workflowName 정의 이름
   * @param stageName 시작이 머무는 단계(노드) 이름
   */
  public record Start(long workflowId, String workflowName, String stageName) {}

  /**
   * 시작이 막히는 이유.
   *
   * @param message 시작 API 가 같은 경우에 돌려줄 한국어 문장
   */
  public record Blocked(String message) {}
}
