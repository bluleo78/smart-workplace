package com.workplace.issue.outbound.dto;

/**
 * ai-agent POST /issue/project-report 응답 DTO(WP-1483).
 *
 * @param markdown AI 가 쓴 리포트 본문 마크다운(후처리 전)
 */
public record ProjectReportAiResult(String markdown) {}
