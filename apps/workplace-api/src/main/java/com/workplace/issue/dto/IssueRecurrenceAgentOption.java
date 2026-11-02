package com.workplace.issue.dto;

/**
 * 실행 일정의 담당 AI 후보(WP-1314) — 그 이슈에서 회차를 맡길 수 있는 서버 실행 AI 하나.
 *
 * @param personalAssistant 보는 사람의 개인 비서인지(목록 첫머리·「내 AI 비서」 표시용). 남의 개인 비서는 후보에 오지 않는다
 */
public record IssueRecurrenceAgentOption(
    long id, String username, String name, boolean personalAssistant) {}
