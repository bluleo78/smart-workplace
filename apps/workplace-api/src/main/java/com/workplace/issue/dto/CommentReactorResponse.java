package com.workplace.issue.dto;

/** 이슈 코멘트 반응자 1명(WP-504). kind = HUMAN/AGENT(웹 아바타 AI 배지용). */
public record CommentReactorResponse(long userId, String name, String kind) {}
