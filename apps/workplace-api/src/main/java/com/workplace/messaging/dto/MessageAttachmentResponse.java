package com.workplace.messaging.dto;

import java.time.Instant;

/** 메시지 첨부 응답 DTO. file 메타 + 첨부자 정보를 평탄화한다. */
public record MessageAttachmentResponse(
    Long fileId,
    Long messageId,
    String originalName,
    String mimeType,
    long sizeBytes,
    Long attachedById,
    String attachedByName,
    Instant attachedAt) {}
