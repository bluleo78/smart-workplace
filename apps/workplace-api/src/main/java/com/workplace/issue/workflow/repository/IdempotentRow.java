package com.workplace.issue.workflow.repository;

/**
 * 이동 멱등 기록 한 행(workflow_move_idempotency) — 같은 실행·같은 key 의 재시도에 첫 응답을 돌려주려고 저장한 것.
 *
 * @param actorId 첫 요청자(탈퇴했으면 null)
 * @param responseJson 저장한 첫 응답 JSON 글
 */
public record IdempotentRow(Long actorId, String responseJson) {}
