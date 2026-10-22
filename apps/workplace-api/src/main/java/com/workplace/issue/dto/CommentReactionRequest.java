package com.workplace.issue.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 이슈 코멘트 반응 추가 요청(WP-504). emoji 1~32자 — 이모지 하나인지는 IssueCommentReactionService 가 판정한다(채팅
 * ReactionRequest 와 같은 규칙).
 */
public record CommentReactionRequest(@NotBlank @Size(min = 1, max = 32) String emoji) {}
