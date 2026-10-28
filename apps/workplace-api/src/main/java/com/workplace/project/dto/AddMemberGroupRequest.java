package com.workplace.project.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 팀 프로젝트(TEAM·OPEN)에 조직도 부서를 멤버로 더한다(WP-1057).
 *
 * @param groupId 조직도 부서(user_group, SHARED) id
 * @param role 부서 구성원이 받을 역할 — 생략하면 MEMBER. MEMBER 외(OWNER 등)는 400 으로 거절한다(멤버 관리 권한은 사람에게만)
 */
public record AddMemberGroupRequest(@NotNull Long groupId, String role) {}
