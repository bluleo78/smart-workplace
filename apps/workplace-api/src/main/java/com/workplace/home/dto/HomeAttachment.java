package com.workplace.home.dto;

import com.workplace.fileai.dto.ExtractionInfo;

/**
 * 메인 AI 채팅 세션 첨부 한 건(WP-234) — 세션 첨부 목록·메시지 조회·ai-agent 요청이 같은 형태를 쓴다. extraction 은 WP-242 공통 계약(추출
 * 행 없으면 NONE).
 */
public record HomeAttachment(
    long fileId,
    long messageId,
    String originalName,
    String mimeType,
    long sizeBytes,
    ExtractionInfo extraction) {

  /** 추출 상태를 붙인 사본(ExtractedTextService.attach 용). */
  public HomeAttachment withExtraction(ExtractionInfo e) {
    return new HomeAttachment(fileId, messageId, originalName, mimeType, sizeBytes, e);
  }
}
