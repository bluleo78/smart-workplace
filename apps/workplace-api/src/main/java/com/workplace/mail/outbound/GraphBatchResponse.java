package com.workplace.mail.outbound;

/**
 * Graph JSON batch 응답 한 건(WP-187) — 최상위 200 이어도 항목별로 실패(429 등)할 수 있다. 응답 순서는 요청 순서와 다를 수 있어 id 로
 * 짝짓는다.
 */
public record GraphBatchResponse(String id, int status) {}
