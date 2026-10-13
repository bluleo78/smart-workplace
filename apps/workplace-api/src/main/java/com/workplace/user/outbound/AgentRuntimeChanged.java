package com.workplace.user.outbound;

/**
 * AI 구성원의 실행 방식(INTERNAL|EXTERNAL)이 바뀌었다는 도메인 이벤트(WP-377). user 모듈이 발행하고, 다른 모듈(issue 의 AI 작업 기록
 * 등)이 실행 방식에 따라 자기 데이터를 정리하는 신호로 쓴다 — user 가 issue 를 직접 import 하지 않기 위한 public 계약.
 *
 * @param agentUserId 실행 방식이 바뀐 AI 구성원
 * @param runtime 바뀐 뒤 실행 방식({@code AgentRuntime.INTERNAL} 또는 {@code EXTERNAL})
 */
public record AgentRuntimeChanged(long agentUserId, String runtime) {}
