package com.workplace.user.dto;

/**
 * 그룹 소속 멤버 요약. targetType=MEMBER→user, EXTERNAL→contact_entry 에서 enrich.
 *
 * <p>username 은 MEMBER 만(EXTERNAL=null) — AI 도구가 숫자 user id 대신 username 으로 사람을 가리키도록(#833·#839).
 */
public record UserGroupMemberSummary(
    String targetType,
    long targetId,
    String name,
    String email,
    String title,
    String organization,
    String username) {}
