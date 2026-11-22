package com.workplace.issue.workflow.dto;

import jakarta.validation.constraints.Size;

/** 켜기·끄기와 이름 바꾸기 요청 — 보낸 칸만 바꾼다(null 은 그대로). 이름은 한 줄로 다듬은 뒤 비면 거절한다. */
public record UpdateWorkflowRequest(
    Boolean enabled,
    @Size(min = 1, max = 100, message = "워크플로우 이름은 1~100자로 입력해 주세요") @StorableText String name) {

  /** 만들기와 같은 규칙으로 검증 전에 다듬는다(null 은 그대로 둠). */
  public UpdateWorkflowRequest {
    name = WorkflowNames.normalize(name);
  }
}
