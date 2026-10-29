package com.workplace.messaging.dto;

import java.time.Instant;

/**
 * DM 읽음 표시(WP-1176) — 대화 상대 한 사람이 어디까지·언제 읽었는지.
 *
 * @param userId 읽은 사람
 * @param name 표시 이름
 * @param lastReadMessageId 읽은 마지막 메시지 id(이 id 이하의 메시지를 읽음)
 * @param readAt 그 위치까지 읽은 시각 — 이 기능 전에 읽은 위치면 null(언제 읽었는지 모름)
 */
public record ChannelReadStateResponse(
    long userId, String name, long lastReadMessageId, Instant readAt) {}
