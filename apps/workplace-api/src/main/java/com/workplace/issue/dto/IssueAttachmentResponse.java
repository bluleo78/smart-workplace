package com.workplace.issue.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.fileai.dto.ExtractionInfo;
import java.time.Instant;

/**
 * 이슈 첨부 응답 DTO. file 메타(이름·MIME·사이즈) 와 매핑 메타(이슈·첨부자·시각) 를 합쳐 1행으로 표현한다.
 *
 * <p>fileId 가 매핑 PK 이며, 클라이언트는 이 값으로 다운로드/삭제 엔드포인트를 호출한다. extraction 은 텍스트 추출 상태로, 목록 조회에서만
 * 채운다(WP-242 — 이력 payload·업로드 응답에는 null 이라 직렬화에서 빠진다).
 */
public record IssueAttachmentResponse(
    Long fileId,
    Long issueId,
    String originalName,
    String mimeType,
    long sizeBytes,
    Long attachedById,
    String attachedByName,
    // 첨부자 username — AI 도구가 표시 이름 대신 이 값으로 사람을 가리킨다(WP-307). 업로드 응답 등 모르는 경로는 null.
    @JsonInclude(JsonInclude.Include.NON_NULL) String attachedByUsername,
    Instant attachedAt,
    @JsonInclude(JsonInclude.Include.NON_NULL) ExtractionInfo extraction) {

  /** 추출 정보를 붙인 사본. */
  public IssueAttachmentResponse withExtraction(ExtractionInfo e) {
    return new IssueAttachmentResponse(
        fileId,
        issueId,
        originalName,
        mimeType,
        sizeBytes,
        attachedById,
        attachedByName,
        attachedByUsername,
        attachedAt,
        e);
  }
}
