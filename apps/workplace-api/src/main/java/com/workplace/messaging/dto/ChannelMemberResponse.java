package com.workplace.messaging.dto;

import java.time.Instant;

/** 채널 멤버 1건. role 은 OWNER/ADMIN/MEMBER, kind 는 user.kind(HUMAN/AGENT). */
public record ChannelMemberResponse(
    Long userId, String name, String kind, String role, Instant joinedAt) {}
