package com.workplace.wiki.dto;

/**
 * 지정한 사람(PEOPLE) 공유의 대상 한 사람(WP-1063) — 웹 {@code WikiShareTargetPerson} 과 같은 모양. 공유 창이 정지된 사람을 다른
 * 사람과 구분해 「비활성」으로 보이게 상태를 함께 준다.
 *
 * @param userId 사용자 id
 * @param name 표시 이름
 * @param active 지금 열 수 있는 사람인지 — 기준은 {@code WikiShareRepository#listPeople}. 정지·비활성 계정은 지정돼 있어도
 *     false
 */
public record WikiShareTargetPerson(long userId, String name, boolean active) {}
