package com.workplace.issue.outbound.dto;

import java.time.Instant;

/** 이슈 채팅 발췌 1줄 — AI 요약 입력용. chat 모듈이 issue 모듈로 넘기는 경량 DTO. */
public record ChatExcerpt(String authorName, String authorKind, String body, Instant createdAt) {}
