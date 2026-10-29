package com.workplace.auth.outbound;

/**
 * 개인 비서가 해제됐다는 도메인 이벤트(WP-1190). 해제는 토큰을 철회하고 연결(FK)만 끊으며 비서 AGENT 행은 남기므로, 그 비서가 돌리던 반복은 그대로 남아
 * 상세에 「다음 실행 …」이 계속 보였다. auth 모듈이 발행하고 issue 모듈이 그 비서의 반복·회차 대기 작업을 거두는 신호로 쓴다 — auth 가 issue 를 직접
 * 부르지 않기 위한 public 계약.
 *
 * @param agentUserId 해제된 개인 비서(AGENT) 사용자 id
 */
public record PersonalAssistantDisabled(long agentUserId) {}
