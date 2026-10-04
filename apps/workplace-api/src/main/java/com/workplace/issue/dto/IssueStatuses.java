package com.workplace.issue.dto;

import java.util.Set;

/**
 * 이슈 상태 분류 상수. 상태는 문자열 컬럼이라 enum 이 없어서, "종료" 판단 기준을 쿼리·서비스마다 리터럴로 반복하던 것을 한 곳에 모은다(WP-243). 진행률
 * 집계·에픽 완료 차단·블로커 계산이 같은 기준을 써야 서로 모순되지 않는다.
 */
public final class IssueStatuses {

  /** 종료 상태(Jira 의 Done 분류) — 완료와 취소 모두 "끝난 일"로 본다. */
  public static final Set<String> CLOSED = Set.of("DONE", "CANCELED");

  private IssueStatuses() {}
}
