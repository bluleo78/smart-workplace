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
    Boolean aiNeedsReply,
    Instant needsReplyDoneAt) {} // P2: 사용자 처리완료 시각(null=미처리). "회신필요" 술어에 사용.
