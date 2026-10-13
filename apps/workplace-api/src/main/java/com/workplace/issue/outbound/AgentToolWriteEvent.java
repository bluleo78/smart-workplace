package com.workplace.issue.outbound;

/**
 * PAT·AI 키 요청이 이슈에 쓰기를 했을 때 발행하는 서비스 이벤트(WP-377). actorId 는 쓰기를 한 사용자, tool 은 요청 헤더로 받은 수행 도구.
 * AgentWorkService 가 같은 트랜잭션에서 받아 작업 기록을 시작·터치한다.
 */
public record AgentToolWriteEvent(long issueId, long actorId, String tool) {}
