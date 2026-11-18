package com.workplace.mail.outbound;

import tools.jackson.databind.JsonNode;

/**
 * Graph JSON batch 응답 한 건(WP-187) — 최상위 200 이어도 항목별로 실패(429 등)할 수 있다. 응답 순서는 요청 순서와 다를 수 있어 id 로
 * 짝짓는다.
 *
 * @param body 항목 응답 본문(WP-962 — 메일 옮기기는 옮긴 메일의 새 id 를 여기서 읽는다). 없으면 null
 * @param retryAfterSeconds 항목 응답 헤더 {@code Retry-After}(초, WP-1682 — 휴지통 비우기가 429 등 항목을 그만큼 기다려 다시
 *     보낸다). 없거나 정수로 읽지 못하면 null
 */
public record GraphBatchResponse(String id, int status, JsonNode body, Integer retryAfterSeconds) {

  /** Retry-After 를 쓰지 않는 응답(옮기기 등). */
  public GraphBatchResponse(String id, int status, JsonNode body) {
    this(id, status, body, null);
  }

  /** 본문이 필요 없는 응답(읽음 반영 등). */
  public GraphBatchResponse(String id, int status) {
    this(id, status, null, null);
  }

  /** 항목이 성공(2xx)했는지 — 옮기기·완전 삭제가 같은 판정을 쓴다. */
  public boolean ok() {
    return status >= 200 && status < 300;
  }
}
