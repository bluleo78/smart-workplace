package com.workplace.user.dto;

/**
 * 그룹 소속 멤버 요약. targetType=MEMBER→user, EXTERNAL→contact_entry 에서 enrich.
 *
 * <p>username 은 MEMBER 만(EXTERNAL=null) — AI 도구가 숫자 user id 대신 username 으로 사람을 가리키도록(#833·#839).
 *
 * <p>leader 는 이 조직의 리더로 지정된 구성원인지(WP-1327) — 조직도 부서의 MEMBER 행만 참일 수 있다(EXTERNAL 은 늘 false).
 */
public record UserGroupMemberSummary(
    String targetType,
    long targetId,
    String name,
    String email,
    String title,
    String organization,
    String username,
    boolean leader) {}
