package com.workplace.messaging.dto;

/** 메시징 AI 대화별 실행 임대 반납 요청(WP-1979). token 은 acquire 가 준 값, leaseMs 는 이어서 돌릴 때 갱신할 임대 길이. */
public record MessagingAgentRunReleaseRequest(
    long channelId, Long parentMessageId, long agentId, String token, long leaseMs) {}
