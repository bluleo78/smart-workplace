package com.workplace.issue.outbound.dto;

/**
 * ai-agent POST /issue/project-status 응답 DTO(WP-1479). 배지·숫자는 API 가 정하므로 AI 는 글만 낸다.
 *
 * @param summary 2~3문장 요약(ai-agent 가 400자에서 자른다 — API 도 한 번 더 자른다)
 */
public record ProjectStatusAiResult(String summary) {}
