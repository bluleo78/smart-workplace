package com.workplace.wiki.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 노트 스페이스에 조직도 부서를 멤버로 더한다(WP-1052). 이미 멤버인 부서면 역할을 덮어쓴다(사람 멤버 추가와 같은 업서트).
 *
 * @param groupId 조직도 부서(user_group, SHARED) id
 * @param role 부서 구성원이 받을 역할(EDITOR | VIEWER — OWNER 는 받지 않는다)
 */
public record AddMemberGroupRequest(@NotNull Long groupId, @NotNull String role) {}
