package com.workplace.issue.dto;

/**
 * 명시 보고 응답(WP-377). 종료 상태 보고면 work=null, ended=true. coercedFrom 은 서버가 보고한 상태를 바꿔 저장했을 때 원래
 * 상태(WP-1217 — AI 가 사람을 멘션한 대기 중 보고는 답변 필요로 저장), 바꾸지 않았으면 null.
 */
public record AgentWorkReportResponse(AgentWorkView work, boolean ended, String coercedFrom) {}
