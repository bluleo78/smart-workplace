package com.workplace.issue.outbound;

import com.workplace.global.security.AgentToolContext;
import org.springframework.context.ApplicationEventPublisher;

/**
 * PAT·AI 키 요청이 이슈에 쓰기를 했을 때 발행하는 서비스 이벤트(WP-377). actorId 는 쓰기를 한 사용자, tool 은 요청 헤더로 받은 수행 도구.
 * AgentWorkService 가 같은 트랜잭션에서 받아 작업 기록을 시작·터치한다. issueNotified 는 발행 쪽이 이미 이슈 변경 알림을 냈는지 — true 면
 * 리스너가 같은 알림을 중복해서 내지 않는다. promoteOnly 는 "이미 있는 진행 중 작업만 이어 쓰고 새로 만들지 않는다" — 이슈 생성 알림이 쓴다(생성은 담당자
 * 추가가 미리 만든 시작 전 작업을 착수로 잇는 것까지만 하고, 사람이든 AI 든 자기를 담당자로 둔 새 이슈에 아직 시작도 안 한 작업 행을 만들면 안 된다).
 * statusWritten 은 이 쓰기가 이슈 상태를 직접 지정했는지 — 그러면 작업이 시작돼도 상태를 진행 중으로 올리지 않는다(요청한 상태가 우선, WP-393).
 */
public record AgentToolWriteEvent(
    long issueId,
    long actorId,
    String tool,
    boolean issueNotified,
    boolean promoteOnly,
    boolean statusWritten) {

  /**
   * 현재 요청이 수행 도구 헤더를 실은 PAT·AI 키 요청이고 자동 터치가 억제되지 않았으며 행위자가 있으면 이벤트를 발행한다. 이슈 쓰기 지점(이슈
   * created·updated 알림·코멘트 작성)이 같은 조건을 한 곳에서 쓰도록 모은 헬퍼 — 브라우저(JWT)·Internal·시스템 쓰기는 조건에서 걸러진다.
   * promoteOnly·statusWritten 은 이벤트 필드와 같은 뜻이다.
   */
  public static void publishIfAgentTool(
      ApplicationEventPublisher publisher,
      long issueId,
      Long actorId,
      boolean issueNotified,
      boolean promoteOnly,
      boolean statusWritten) {
    String tool = AgentToolContext.current();
    if (tool == null || actorId == null || AgentToolContext.touchSuppressed()) return;
    publisher.publishEvent(
        new AgentToolWriteEvent(issueId, actorId, tool, issueNotified, promoteOnly, statusWritten));
  }
}
