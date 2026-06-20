package com.workplace.messaging.dto;

import java.time.Instant;

/**
 * 채널 1건 요약. caller 관점 필드 포함.
 *
 * @param member caller 가 멤버인지
 * @param role caller 의 채널 역할(OWNER/ADMIN/MEMBER), 비멤버면 null
 * @param archived 아카이브 여부
 * @param memberCount 멤버 수
 * @param unreadCount caller 미읽음 메시지 수(본인 작성·삭제 제외)
 * @param hasUnreadThreads 내가 팔로우하는 미읽음 스레드가 이 채널에 있으면 true
 */
public record ChannelResponse(
    Long id,
    String kind,
    String name,
    String visibility,
    boolean member,
    String role,
    boolean archived,
    int memberCount,
    long unreadCount,
    Instant createdAt,
    boolean hasUnreadThreads) {}
