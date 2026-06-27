package com.workplace.issue.dto;

import java.util.List;

/**
 * 이슈 상세 응답 DTO: 요약 + 본문 + 코멘트 + 히스토리 + 첨부 + AI 즉시 컨텍스트.
 *
 * <p>aiContext 는 저장 요약이 없고 블로커도 없으면 null(프론트 카드 미렌더). 단순 목록 조회(IssueResponse) 경로에서는 사용하지 않는다.
 */
public record IssueDetailResponse(
    IssueResponse summary,
    String body,
    List<IssueCommentResponse> comments,
    List<IssueHistoryEntryResponse> history,
    List<IssueAttachmentResponse> attachments,
    /** AI 즉시 컨텍스트(요약+블로커). 없으면 null. */
    IssueAiContext aiContext) {}
