package com.workplace.user.dto;

import com.workplace.global.dto.UserSummary;

/**
 * 담당자 지정 처리용 사용자 정보 — 활성 여부와 AI 실행 방식까지 한 번의 조회로 담는다(WP-377). 담당자 교체·이슈 생성이 비활성 검사·요약 조립·외부 실행 AI
 * 판별을 사용자 쿼리 한 번으로 끝내도록 쓴다. agentRuntime 은 AGENT 가 아니면 의미 없다.
 *
 * @param agentRuntime INTERNAL | EXTERNAL (AGENT 만 값이 의미 있다)
 */
public record AssigneeInfo(
    Long id, String username, String name, String kind, boolean isActive, String agentRuntime) {

  /** 외부 실행 AI 구성원인지 — 담당자로 들어올 때 "시작 전" 작업을 만드는 대상. */
  public boolean isExternalAgent() {
    return UserKind.isAgent(kind) && AgentRuntime.EXTERNAL.equals(agentRuntime);
  }

  /** 응답·이력용 사용자 요약. */
  public UserSummary toSummary() {
    return new UserSummary(id, username, name, kind);
  }
}
