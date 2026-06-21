package com.workplace.chat.dto;

import java.time.Instant;

/** chat 메시지 첨부 응답 DTO. file 메타 + 첨부자 정보를 평탄화한다. (MessageAttachmentResponse 미러) */
public record ChatMessageAttachmentResponse(
    Long fileId,
    Long messageId,
    String originalName,
    String mimeType,
    long sizeBytes,
    Long attachedById,
    String attachedByName,
    Instant attachedAt) {}
