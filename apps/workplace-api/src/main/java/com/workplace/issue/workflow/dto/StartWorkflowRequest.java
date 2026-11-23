package com.workplace.issue.workflow.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 워크플로우 시작 요청(WP-1985).
 *
 * @param workflowId 시작할 워크플로우(같은 프로젝트의 것만, 활성 게시 버전으로 시작한다)
 * @param dryRun true 면 저장하지 않고 같은 판정으로 시작했을 때의 view 만 돌려준다(빠지면 false)
 */
public record StartWorkflowRequest(@NotNull Long workflowId, Boolean dryRun) {

  /** dryRun 이 빠졌으면 실제 시작으로 본다. */
  public boolean isDryRun() {
    return Boolean.TRUE.equals(dryRun);
  }
}
