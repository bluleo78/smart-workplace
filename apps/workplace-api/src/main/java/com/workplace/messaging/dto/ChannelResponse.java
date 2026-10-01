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
 * @param lastReadMessageId caller 의 읽음 워터마크(이보다 id 가 큰 메시지가 미읽음). 비멤버·미선택 시 null
 * @param lastMessage 마지막 최상위 메시지 요약(목록 미리보기). 사이드바 목록에서만 채움, 그 외 null
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
    boolean hasUnreadThreads,
    Long lastReadMessageId,
    LastMessageSummary lastMessage) {

  /** lastMessage 없이 생성 — 목록 외 경로(탐색·상세·생성)는 미리보기를 싣지 않는다. */
  public ChannelResponse(
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
      boolean hasUnreadThreads,
      Long lastReadMessageId) {
    this(
        id,
        kind,
        name,
        visibility,
        member,
        role,
        archived,
        memberCount,
        unreadCount,
        createdAt,
        hasUnreadThreads,
        lastReadMessageId,
        null);
  }

  /** 미리보기만 바꾼 사본 — 서비스가 배치 조회 결과를 병합할 때 사용. */
  public ChannelResponse withLastMessage(LastMessageSummary lm) {
    return new ChannelResponse(
        id,
        kind,
        name,
        visibility,
        member,
        role,
        archived,
        memberCount,
        unreadCount,
        createdAt,
        hasUnreadThreads,
        lastReadMessageId,
        lm);
  }
}
