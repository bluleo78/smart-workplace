package com.workplace.user.dto;

/** 그룹 소속 멤버 요약. targetType=MEMBER→user, EXTERNAL→contact_entry 에서 enrich. */
public record UserGroupMemberSummary(
    String targetType,
    long targetId,
    String name,
    String email,
    String title,
    String organization) {}
