package com.workplace.agentruntime.dto;

import java.time.OffsetDateTime;

/**
 * AI 실행 상태 요약 한 줄(WP-1254) — 관리자 AI 목록이 AI 마다 실행 설정을 따로 부르지 않고 한 번에 실행 상태를 그리게 한다. 실행 설정 행이
 * 있는(Works 가 작업 공간에서 띄우는) AI 만 나온다.
 *
 * @param templateTitle 템플릿 카드 제목(템플릿이 사라졌으면 null)
 * @param status 원하는 상태와 관찰 상태를 합친 화면용 실행 상태
 * @param agentState AI 스스로 보고한 상태(IDLE·WORKING·BLOCKED, 없으면 null)
 * @param locationName 실제 실행 위치 이름 — 워크스페이스 기본 위치면(위치 미지정 포함) null
 * @param message runner 가 보고한 관찰 메시지(예: 실패 이유, 없으면 null)
 */
public record AgentRuntimeSummaryResponse(
    long agentUserId,
    String templateName,
    String templateTitle,
    AgentRuntimeStatus status,
    String agentState,
    String agentIssueKey,
    OffsetDateTime agentNextCheckAt,
    String locationName,
    String message) {}
