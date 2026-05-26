package com.workplace.issue.exception;

/**
 * AGENT 가 자기 자신을 제외한 assignee 집합을 변경하려 시도 — 403. AGENT 는 본인을 추가하거나 다른 사람을 추가/제거할 수 없고, 본인을 제거하는 것만
 * 허용된다.
 */
public class IssueAssigneeAgentRestrictionException extends RuntimeException {
  public IssueAssigneeAgentRestrictionException() {
    super("AGENT 는 자기 자신만 담당자에서 제외할 수 있습니다");
  }
}
