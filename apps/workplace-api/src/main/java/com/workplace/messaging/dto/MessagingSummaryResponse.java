package com.workplace.messaging.dto;

import java.util.List;

/**
 * 홈 위젯용 대화 요약.
 *
 * <ul>
 *   <li>unreadConversationCount — 안읽음(>0) 대화 수
 *   <li>needsReplyCount — 회신 대기 수(안읽음 DM + 안읽은 멘션 채널). 헤더 "회신 대기 N"
 *   <li>recent — 최근 대화 N건(신호 우선 → 최신순)
 * </ul>
 */
public record MessagingSummaryResponse(
    long unreadConversationCount, long needsReplyCount, List<ConversationSummaryItem> recent) {}
