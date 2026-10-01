package com.workplace.mail.dto;

import java.time.Instant;

/** 메일 목록 한 행(본문 제외, 미리보기 snippet 포함). */
public record EmailMessageSummary(
    long id,
    long accountId,
    String threadId,
    String fromAddress,
    String fromName,
    String subject,
    String snippet,
    Instant receivedAt,
    boolean seen,
    boolean hasAttachment,
    String aiCategory,
    Boolean aiNeedsReply) {} // 회신필요 = aiNeedsReply && !seen (WP-146 단일 술어)
