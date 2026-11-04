package com.workplace.search.dto;

import java.time.Instant;

/**
 * 통합 검색 「대화」 탭의 메시지 한 건(WP-1358). channelKind 는 "CHANNEL"|"DM", channelName 은 채널 이름 또는 DM 이면 나를 뺀
 * 상대 표시 이름(대화 목록과 같은 규칙). parentMessageId 는 스레드 답글이면 루트 메시지 id(화면이 스레드 칸까지 연다). excerpt 는 맞은 곳 주변 한
 * 줄 발췌다.
 */
public record MessageSearchHit(
    long id,
    long channelId,
    String channelKind,
    String channelName,
    Long parentMessageId,
    String authorName,
    String authorKind,
    String excerpt,
    Instant createdAt) {}
