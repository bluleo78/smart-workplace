package com.workplace.messaging.dto;

import java.time.Instant;

/** 대화 요약 리포지토리의 중간 행(내부 전용). 최근 대화 1건의 마지막 메시지 메타 + 안읽음 수. 멘션/스레드/참가자는 서비스가 배치 조회로 보강한다. */
public record ConversationRow(
    long channelId,
    String kind, // "CHANNEL" | "DM"
    String channelName, // 채널명(DM 은 null)
    Long lastMessageId,
    Instant lastMessageAt,
    Long lastAuthorId, // 마지막 메시지 작성자 id(없으면 null)
    String lastAuthorName,
    String lastBody,
    long unreadCount) {}
