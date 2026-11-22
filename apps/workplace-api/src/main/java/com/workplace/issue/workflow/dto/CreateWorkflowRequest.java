package com.workplace.issue.workflow.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 워크플로우 만들기 요청. 이름은 한 줄로 다듬은 뒤 1~100자이고 YAML 의 name 과 맞추지 않는다. YAML 은 오류가 있어도 초안으로 저장하므로 빈 글도 받는다.
 */
public record CreateWorkflowRequest(
    @NotNull(message = "워크플로우 이름을 입력해 주세요")
        @Size(min = 1, max = 100, message = "워크플로우 이름은 1~100자로 입력해 주세요")
        @StorableText
        String name,
    @NotNull(message = "YAML 내용을 보내 주세요") @StorableText String yaml) {

  /**
   * 검증 전에 프로젝트·버전 이름과 같은 규칙으로 다듬는다 — 방향 제어·줄 바꿈·앞뒤 제로폭으로 같은 이름을 둘 만들지 못하게(WP-908). 글자 사이 제로폭은 그
   * 규칙대로 남는다. 보이는 글자가 없으면 빈 글이 되고, 원문이 너무 길면 다듬지 않으므로({@link WorkflowNames}) 둘 다 길이 검증이 거절한다.
   */
  public CreateWorkflowRequest {
    name = WorkflowNames.normalize(name);
  }
}
