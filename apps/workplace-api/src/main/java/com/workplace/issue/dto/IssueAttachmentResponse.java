package com.workplace.issue.dto;

import java.time.Instant;

/**
 * 이슈 첨부 응답 DTO. file 메타(이름·MIME·사이즈) 와 매핑 메타(이슈·첨부자·시각) 를 합쳐 1행으로 표현한다.
 *
 * <p>fileId 가 매핑 PK 이며, 클라이언트는 이 값으로 다운로드/삭제 엔드포인트를 호출한다.
 */
public record IssueAttachmentResponse(
    Long fileId,
    Long issueId,
    String originalName,
    String mimeType,
    long sizeBytes,
    Long attachedById,
    String attachedByName,
    Instant attachedAt) {}
