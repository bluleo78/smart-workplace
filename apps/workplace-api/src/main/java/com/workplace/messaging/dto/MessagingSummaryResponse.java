package com.workplace.messaging.dto;

import java.util.List;

/**
 * 홈 위젯용 대화 요약.
 *
 * <ul>
 *   <li>unreadConversationCount — 안읽음(>0) 대화 수
 *   <li>needsReplyCount — 회신 대기 수(안읽음 DM + 안읽은 멘션 채널). 헤더 "회신 대기 N"
 *   <li>aiAttentionCount — 여전히 안읽음인 AI 발굴 대화 수. 헤더 "AI 주목 N"
 *   <li>attentionCount — "확인 필요" KPI 단일값. 회신 대기 ∪ AI 발굴 안읽음의 합집합 distinct 채널 수(이중 집계 제거)
 *   <li>recent — 최근 대화 N건(신호 우선 → 최신순)
 * </ul>
 */
public record MessagingSummaryResponse(
    long unreadConversationCount,
    long needsReplyCount,
    /** 여전히 안읽음인 AI 발굴 대화 수(conversation_attention 마크 있고 안읽음). */
    long aiAttentionCount,
    /** "확인 필요" KPI 합집합 dedup 카운트(needsReply ∪ aiAttention distinct 채널 수). */
    long attentionCount,
    List<ConversationSummaryItem> recent) {}
