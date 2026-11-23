package com.workplace.issue.workflow.repository;

import java.time.Instant;

/**
 * 실행 이벤트 한 행(workflow_run_event) — 시작·이동·한도 도달 등 실행에 일어난 일의 기록.
 *
 * @param payloadJson 이벤트 내용 JSON 글
 * @param actorId 일으킨 사용자(없으면 null)
 */
public record RunEventRow(
    long id, long runId, String type, String payloadJson, Long actorId, Instant at) {}
