package com.workplace.project.dto;

import java.time.Instant;

/** 프로젝트 멤버 응답 DTO. username/name/kind 는 user 테이블 JOIN 결과. */
public record MemberResponse(
    Long userId, String username, String name, String kind, String role, Instant createdAt) {}
