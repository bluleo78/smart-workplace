package com.workplace.chat.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.fileai.dto.ExtractionInfo;
import java.time.Instant;

/**
 * chat 메시지 첨부 응답 DTO. file 메타 + 첨부자 정보를 평탄화한다. (MessageAttachmentResponse 미러)
 *
 * <p>extraction 은 텍스트 추출 상태로 메시지 하이드레이션에서만 채운다(WP-242 — 그 외에는 null 이라 직렬화에서 빠진다).
 */
public record ChatMessageAttachmentResponse(
    Long fileId,
    Long messageId,
    String originalName,
    String mimeType,
    long sizeBytes,
    Long attachedById,
    String attachedByName,
    Instant attachedAt,
    @JsonInclude(JsonInclude.Include.NON_NULL) ExtractionInfo extraction) {

  /** 추출 정보를 붙인 사본. */
  public ChatMessageAttachmentResponse withExtraction(ExtractionInfo e) {
    return new ChatMessageAttachmentResponse(
        fileId,
        messageId,
        originalName,
        mimeType,
        sizeBytes,
        attachedById,
        attachedByName,
        attachedAt,
        e);
  }
}
