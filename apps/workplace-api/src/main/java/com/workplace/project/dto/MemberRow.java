package com.workplace.project.dto;

import java.time.Instant;

/** 리포지토리 → 서비스 전달용 내부 멤버 row. */
public record MemberRow(Long projectId, Long userId, String role, Instant createdAt) {}
