package com.workplace.issue.outbound;

import com.workplace.global.security.AgentToolContext;
import org.springframework.context.ApplicationEventPublisher;

/**
 * PAT·AI 키 요청이 이슈에 쓰기를 했을 때 발행하는 서비스 이벤트(WP-377). actorId 는 쓰기를 한 사용자, tool 은 요청 헤더로 받은 수행 도구.
 * AgentWorkService 가 같은 트랜잭션에서 받아 작업 기록을 시작·터치한다.
 */
public record AgentToolWriteEvent(long issueId, long actorId, String tool) {

  /**
   * 현재 요청이 수행 도구 헤더를 실은 PAT·AI 키 요청이고 자동 터치가 억제되지 않았으며 행위자가 있으면 이벤트를 발행한다. 이슈 쓰기 지점(이슈 updated
   * 알림·코멘트 작성)이 같은 조건을 한 곳에서 쓰도록 모은 헬퍼 — 브라우저(JWT)·Internal·시스템 쓰기는 조건에서 걸러진다.
   */
  public static void publishIfAgentTool(
      ApplicationEventPublisher publisher, long issueId, Long actorId) {
    String tool = AgentToolContext.current();
    if (tool == null || actorId == null || AgentToolContext.touchSuppressed()) return;
    publisher.publishEvent(new AgentToolWriteEvent(issueId, actorId, tool));
  }
}
