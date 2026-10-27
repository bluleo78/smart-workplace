package com.workplace.wiki.dto;

/**
 * 지정한 사람(PEOPLE) 공유가 여는 조직도 부서 한 줄(WP-1023) — 웹 {@code WikiShareGroup} 과 같은 모양. 공유 창이 「개발팀 · 3명」처럼
 * 보인다.
 *
 * @param groupId 조직도 부서(user_group, SHARED) id
 * @param name 부서 이름
 * @param memberCount 지금 열 수 있는 사람 수 — 그 부서와 하위 부서의 활성 사람 구성원(중복 제외). 연락처 화면의 멤버 목록과 같은 기준
 */
public record WikiShareGroup(long groupId, String name, int memberCount) {}
