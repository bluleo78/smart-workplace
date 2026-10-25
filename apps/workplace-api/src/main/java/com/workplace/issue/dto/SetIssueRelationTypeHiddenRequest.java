package com.workplace.issue.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 관계 유형 숨김 켜고 끄기 요청. {@code hidden} 은 필수 — 원시 boolean 이면 빈 본문 {@code {}} 이 조용히 false(숨김 해제)로 읽혀
 * 의도하지 않은 변경이 됐다.
 */
public record SetIssueRelationTypeHiddenRequest(@NotNull Boolean hidden) {}
