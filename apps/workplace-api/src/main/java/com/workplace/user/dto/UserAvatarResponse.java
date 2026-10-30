package com.workplace.user.dto;

/**
 * 워크스페이스 구성원 아바타 목록 한 줄(WP-1222, {@code GET /api/v1/users/avatars}). 웹이 목록을 한 번 받아 캐시하고 userId 로
 * 찾는다.
 *
 * @param avatarUrl 공개 이미지 주소(크기 조각 제외) — 웹이 {@code avatarUrl + "/" + size} 로 쓴다
 */
public record UserAvatarResponse(long userId, String avatarUrl) {}
