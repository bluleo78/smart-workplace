package com.workplace.chat.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * 메시지 페이징 응답. cursor 는 base64(createdAt|id).
 *
 * <p>truncated 는 "다음 페이지(커서)는 없지만 앞쪽이 잘려 부분 목록"일 때만 true — afterMine 에 내 글이 없어 최신 limit 개만 돌려준 경우처럼
 * 이어 읽을 곳이 없어도 목록이 전부가 아님을 알린다(WP-373). 그 외에는 null 이라 응답에서 빠진다.
 */
public record ChatMessagePage(
    List<ChatMessageResponse> items,
    String nextCursor,
    boolean hasMore,
    @JsonInclude(JsonInclude.Include.NON_NULL) Boolean truncated) {

  /** 잘림 표시가 없는 일반 페이지. */
  public ChatMessagePage(List<ChatMessageResponse> items, String nextCursor, boolean hasMore) {
    this(items, nextCursor, hasMore, null);
  }
}
