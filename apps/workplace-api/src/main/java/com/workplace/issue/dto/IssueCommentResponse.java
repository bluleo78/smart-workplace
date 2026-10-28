package com.workplace.issue.dto;

import com.workplace.global.dto.MentionResponse;
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
    List<CommentReactionResponse> reactions,
    // 본문의 멘션 토큰(<@id>)이 가리키는 사용자(WP-1095). 프로젝트에서 빠진 사람도 이름이 보이도록 멤버 목록이 아니라 사용자 테이블에서 채운다.
    // 없는 사용자 id 는 빠진다(화면은 「알 수 없음」).
    List<MentionResponse> mentions) {

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
        reactions,
        mentions);
  }

  /** 멘션 사용자만 바꾼 사본 — 리포지토리가 조회한 코멘트들의 멘션을 한 번의 사용자 조회로 채울 때 쓴다(WP-1095). */
  public IssueCommentResponse withMentions(List<MentionResponse> mentions) {
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
        reactions,
        mentions);
  }
}
