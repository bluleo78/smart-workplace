package com.workplace.wiki.dto;

/**
 * 스페이스 멤버 응답. departmentRole — 이 사람이 멤버 부서로 받는 역할(WP-1102, 없으면 null). 실효 역할은 role 과 이 값 중 높은 쪽이라,
 * 직접 역할을 낮춰도 부서 역할이 높으면 그대로 쓸 수 있음을 멤버 창이 안내한다.
 */
public record WikiMemberResponse(long userId, String name, String role, String departmentRole) {}
