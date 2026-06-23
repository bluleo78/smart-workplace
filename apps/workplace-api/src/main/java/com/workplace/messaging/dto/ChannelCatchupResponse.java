package com.workplace.messaging.dto;

import java.util.List;

/** 채널 캐치업 카드 응답. yourTurn 은 백엔드 멘션 규칙, decisions/discussion 은 AI 요약. */
public record ChannelCatchupResponse(
    int unreadCount,
    List<SummaryGroup> decisions,
    List<MentionItem> yourTurn,
    List<SummaryGroup> discussion) {

  /** AI 요약 한 항목 + 근거 메시지 id. */
  public record SummaryGroup(String text, List<Long> sourceMessageIds) {}

  /** 나를 멘션한 미읽음 메시지(내 차례). */
  public record MentionItem(long messageId, String authorName, String snippet) {}
}
