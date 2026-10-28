package com.workplace.project.dto;

/**
 * 프로젝트 멤버로 둔 조직도 부서 한 줄(WP-1057) — 멤버 창이 「개발팀 · 12명 [조직]」과 역할로 보인다.
 *
 * @param groupId 조직도 부서(user_group, SHARED) id
 * @param name 부서 이름
 * @param role 부서 구성원이 받는 역할 — 늘 MEMBER(OWNER 는 사람만)
 * @param memberCount 지금 이 역할로 들어오는 사람 수 — 그 부서와 하위 부서의 활성 사람 구성원(중복 제외). 접근 판정과 같은 기준
 */
public record ProjectMemberGroupResponse(long groupId, String name, String role, int memberCount) {}
