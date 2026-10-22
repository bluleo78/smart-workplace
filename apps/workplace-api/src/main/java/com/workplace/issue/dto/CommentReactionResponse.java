package com.workplace.issue.dto;

/** 이슈 코멘트 이모지별 반응 집계(WP-504). reacted = 보는 사람이 이 이모지를 눌렀는지(칩 강조·토글 방향 판정용). */
public record CommentReactionResponse(String emoji, int count, boolean reacted) {}
