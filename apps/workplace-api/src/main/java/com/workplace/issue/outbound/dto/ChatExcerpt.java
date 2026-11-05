package com.workplace.issue.outbound.dto;

import java.time.Instant;

/**
 * 이슈 채팅 발췌 1줄 — AI 요약 입력용. chat 모듈이 issue 모듈로 넘기는 경량 DTO.
 *
 * @param authorId 글쓴이 id — 반복 회차(WP-1375)가 「맡긴 사람」 글인지 가리는 데 쓴다
 */
public record ChatExcerpt(
    String authorName, String authorKind, String body, Instant createdAt, long authorId) {}
