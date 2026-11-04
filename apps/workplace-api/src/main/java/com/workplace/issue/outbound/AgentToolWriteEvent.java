package com.workplace.issue.outbound;

import com.workplace.global.security.AgentToolContext;
import org.springframework.context.ApplicationEventPublisher;

/**
 * PAT·AI 키 요청이 이슈에 쓰기를 했을 때 발행하는 서비스 이벤트(WP-377). actorId 는 쓰기를 한 사용자, tool 은 요청 헤더로 받은 수행 도구.
 * AgentWorkService 가 같은 트랜잭션에서 받아 이미 있는 작업 기록만 터치한다 — 이 쓰기로 작업을 새로 시작하지는 않는다(WP-1365, 작업 시작은 명시 보고
 * report_agent_work 로만 — claim_issue 는 담당자만 더하므로 그 뒤 첫 보고가 시작한다). issueNotified 는 발행 쪽이 이미 이슈 변경
 * 알림을 냈는지 — true 면 리스너가 같은 알림을 중복해서 내지 않는다.
 */
public record AgentToolWriteEvent(long issueId, long actorId, String tool, boolean issueNotified) {

  /**
   * 현재 요청이 수행 도구 헤더를 실은 PAT·AI 키 요청이고 작업 터치가 억제되지 않았으며 행위자가 있으면 이벤트를 발행한다. 이슈 쓰기 지점(이슈 updated
   * 알림·코멘트 작성)이 같은 조건을 한 곳에서 쓰도록 모은 헬퍼 — 브라우저(JWT)·Internal·시스템 쓰기는 조건에서 걸러진다.
   */
  public static void publishIfAgentTool(
      ApplicationEventPublisher publisher, long issueId, Long actorId, boolean issueNotified) {
    String tool = AgentToolContext.current();
    if (tool == null || actorId == null || AgentToolContext.touchSuppressed()) return;
    publisher.publishEvent(new AgentToolWriteEvent(issueId, actorId, tool, issueNotified));
  }
}
