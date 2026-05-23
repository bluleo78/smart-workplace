package com.workplace.issue.dto;

/** 이슈 응답 내부에서 사용하는 사용자 요약. id/username/name 만 노출한다. */
public record UserSummary(Long id, String username, String name) {}
