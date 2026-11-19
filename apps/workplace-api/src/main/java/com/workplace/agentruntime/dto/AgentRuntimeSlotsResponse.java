package com.workplace.agentruntime.dto;

/**
 * AI 한 명의 동시 진행 자리(WP-1775) — 에이전트 상세 「동시 진행」 행이 전체 AI 목록(/me/ai-agents)을 읽지 않고 「지금 n개 진행 중」을 그리는 데
 * 쓴다. 값은 AI별 현황과 같은 기준(AgentSlotCounter)이다.
 *
 * @param used 지금 쓰는 자리 수(볼 수 없는 프로젝트 것도 센다)
 * @param limit 실제 적용 상한(덮어쓴 값 ?? 템플릿 기본 ?? 5)
 */
public record AgentRuntimeSlotsResponse(int used, int limit) {}
