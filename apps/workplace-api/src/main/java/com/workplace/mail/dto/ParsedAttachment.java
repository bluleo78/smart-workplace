package com.workplace.mail.dto;

/**
 * IMAP/Graph 파싱 단계의 첨부 메타(내부 캐리어). 바이너리는 저장하지 않는다.
 *
 * <p>providerAttachmentId: Graph 첨부의 안정 id — ordinal 의존 없이 직접 조회에 사용. IMAP 경로는 null.
 */
public record ParsedAttachment(
    String filename,
    String contentType,
    long sizeBytes,
    String contentId,
    String providerAttachmentId) {}
