package com.workplace.user.dto;

/**
 * 아바타를 바꾼 결과(WP-1222, {@code PUT .../avatar}).
 *
 * @param avatarUrl 새 공개 이미지 주소(크기 조각 제외) — {@code /api/v1/avatars/{userId}/{hash}}
 */
public record AvatarResponse(String avatarUrl) {}
