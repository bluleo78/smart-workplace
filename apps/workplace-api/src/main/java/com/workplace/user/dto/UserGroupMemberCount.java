package com.workplace.user.dto;

/**
 * 그룹과 하위 조직의 구성원 수(WP-1135) — 메일 받는 사람 후보 줄의 「N명」처럼 인원만 보일 때 구성원 전체를 받지 않게 한다. 셈은 구성원 찾기(빈 검색어)와 같은
 * 규칙이다: 같은 사람(종류·id)은 하위 조직 여러 곳에 있어도 한 번, 주소가 없는 사람도 센다.
 *
 * @param groupId 센 그룹
 * @param total 하위 조직 포함 구성원 수(구성원 찾기 결과 행 수와 같다)
 * @param external 그중 외부 연락처 수
 */
public record UserGroupMemberCount(long groupId, int total, int external) {}
