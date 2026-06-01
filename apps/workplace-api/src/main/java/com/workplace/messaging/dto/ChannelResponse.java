package com.workplace.messaging.dto;

import java.time.Instant;

/** 채널 1건 요약 + 현재 caller 의 멤버 여부. */
public record ChannelResponse(
    Long id, String kind, String name, String visibility, boolean member, Instant createdAt) {}
