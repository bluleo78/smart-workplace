package com.workplace.issue.exception;

/**
 * AGENT 가 허용되지 않은 assignee 변경을 시도 — 403. AGENT 는 담당자에서 자기 자신을 빼거나, 자기가 맡은 이슈의 담당자 없는 바로 아래 하위 항목(열린
 * 것)을 혼자 맡는 것만 허용된다(WP-375 §3.5). 메시지는 MCP 도구 결과로 AI 에게 그대로 전달되므로 허용되는 경우를 함께 안내한다.
 */
public class IssueAssigneeAgentRestrictionException extends RuntimeException {
  public IssueAssigneeAgentRestrictionException() {
    super("AI 는 담당자에서 자기를 빼거나, 자기가 맡은 이슈의 담당자 없는 바로 아래 하위 항목을 혼자 맡을 때만 담당자를 바꿀 수 있습니다");
  }
}
