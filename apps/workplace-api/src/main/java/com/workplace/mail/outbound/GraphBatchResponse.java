package com.workplace.mail.outbound;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Graph JSON batch 응답 한 건(WP-187) — 최상위 200 이어도 항목별로 실패(429 등)할 수 있다. 응답 순서는 요청 순서와 다를 수 있어 id 로
 * 짝짓는다.
 *
 * @param body 항목 응답 본문(WP-962 — 메일 옮기기는 옮긴 메일의 새 id 를 여기서 읽는다). 없으면 null
 */
public record GraphBatchResponse(String id, int status, JsonNode body) {

  /** 본문이 필요 없는 응답(읽음 반영 등). */
  public GraphBatchResponse(String id, int status) {
    this(id, status, null);
  }
}
