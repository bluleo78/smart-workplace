package com.workplace.messaging.dto;

import java.time.Instant;

/**
 * 대화 1건 — 클릭 전 판단용 3축(누가·용건·급함).
 *
 * <ul>
 *   <li>kind/conversationId — 딥링크(/chat/channels|dms/{id})
 *   <li>label — 채널명 또는 DM 참가자명(프론트에서 dmDisplayName 적용 가능하도록 participants 대신 라벨 확정)
 *   <li>lastAuthorName/lastMessagePreview — 용건(본인/시스템이면 lastAuthorName=null)
 *   <li>mentioned/needsReply/newThreadReplyCount — 신호 배지
 *   <li>aiReason — AI가 암묵적 관련성을 발굴한 사유(없으면 null; 안읽음이고 AI 마크가 있을 때만 non-null)
 * </ul>
 */
public record ConversationSummaryItem(
    String kind,
    long conversationId,
    String label,
    String lastAuthorName,
    String lastMessagePreview,
    Instant lastMessageAt,
    long unreadCount,
    boolean mentioned,
    boolean needsReply,
    int newThreadReplyCount,
    /** AI가 암묵적 관련성을 발굴한 사유(없으면 null). */
    String aiReason) {}
