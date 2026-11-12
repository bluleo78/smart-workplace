package com.workplace.issue.outbound.dto;

/**
 * ai-agent POST /issue/personal-report 응답 DTO(WP-1486).
 *
 * @param markdown AI 가 쓴 개인 보고 본문 마크다운(후처리 전)
 */
public record PersonalReportAiResult(String markdown) {}
