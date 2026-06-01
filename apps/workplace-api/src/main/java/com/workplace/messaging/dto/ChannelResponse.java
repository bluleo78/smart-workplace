package com.workplace.messaging.dto;

import java.time.Instant;

/**
 * 채널 1건 요약. caller 관점 필드 포함.
 *
 * @param member caller 가 멤버인지
 * @param role caller 의 채널 역할(OWNER/ADMIN/MEMBER), 비멤버면 null
 * @param archived 아카이브 여부
 * @param memberCount 멤버 수
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
    Instant createdAt) {}
