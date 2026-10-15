package com.workplace.issue.outbound;

/**
 * MCP(수행 도구 헤더) 쓰기로 할 일(TODO) 이슈의 AI 작업이 막 시작됐다는 이벤트(WP-393) — 새 작업 행을 만들었거나 시작 전(SUBMITTED) 작업을 작업
 * 중으로 이었고, 그 쓰기가 상태를 직접 지정하지 않았을 때만 낸다. 발행 쪽이 이미 읽은 이슈의 프로젝트·번호를 실어 다시 읽지 않게 한다. 이슈 상태를 진행 중으로 올리는
 * 일은 IssueService 에 기대야 하는데 AgentWorkService 는 순환 의존 때문에 그것을 쓸 수 없어, 같은 트랜잭션의 동기
 * 리스너(AgentWorkReportService)에게 넘긴다.
 */
public record AgentWorkAutoStarted(long projectId, int issueNumber, long actorId) {}
