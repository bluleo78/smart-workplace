package com.workplace.issue.outbound.dto;

import com.workplace.issue.overview.status.ProjectStatusInputs;

/**
 * ai-agent POST /issue/project-status 요청 DTO(WP-1479) — 시스템이 계산한 개요 숫자와 배지를 보내 2~3문장 요약 글만 받는다. 필드
 * 이름은 ai-agent 의 projectStatusInputSchema 와 1:1 이다.
 *
 * @param projectName 프로젝트 이름(프롬프트용)
 * @param badge 시스템이 정한 배지(ON_TRACK / WARN / RISK) — AI 가 뒤집지 않는다
 * @param inputs 개요 계산값
 * @param assistantAgentId 요약에 쓸 워크스페이스 공통 비서 사용자 id
 * @param model 비서 모델
 * @param maxTurns 비서 최대 턴
 * @param timeoutMs 비서 타임아웃(ms)
 */
public record ProjectStatusAiRequest(
    String projectName,
    String badge,
    ProjectStatusInputs inputs,
    long assistantAgentId,
    String model,
    int maxTurns,
    long timeoutMs) {}
