package com.workplace.issue.dto;

import java.time.Instant;
import java.util.List;

/** 이슈 코멘트 응답 DTO. 작성자 표시 이름 + kind 포함 (USER/AGENT 시각 구분용). */
public record IssueCommentResponse(
    Long id,
    Long issueId,
    Long authorId,
    String authorName,
    String authorKind,
    String body,
    Instant createdAt,
    Instant updatedAt,
    // 작성자 username — AI 도구가 표시 이름 대신 이 값으로 사람을 가리킨다(WP-307). 멤버가 아닌 작성자도 채워진다.
    String authorUsername,
    // 이모지별 반응 집계(WP-504). 리포지토리는 빈 목록으로 만들고, 보는 사람별 reacted 는 IssueCommentReactionService.enrich 가
    // 채운다.
    List<CommentReactionResponse> reactions) {

  /** 반응 집계만 바꾼 사본 — 코멘트 조회 뒤 한 번의 집계 쿼리로 채울 때 쓴다. */
  public IssueCommentResponse withReactions(List<CommentReactionResponse> reactions) {
    return new IssueCommentResponse(
        id,
        issueId,
        authorId,
        authorName,
        authorKind,
        body,
        createdAt,
        updatedAt,
        authorUsername,
        reactions);
  }
}
