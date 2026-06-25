package com.workplace.user.dto;

/** 구성원 생성 응답. role 은 부여된 RBAC 역할(ADMIN/USER). status 는 멤버십 상태. */
public record MemberResponse(
    Long userId, String username, String name, String email, String role, String status) {}
