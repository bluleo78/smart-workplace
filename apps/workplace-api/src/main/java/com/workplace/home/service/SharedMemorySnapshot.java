package com.workplace.home.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.home.repository.SharedAiMemoryRepository.Row;
import java.util.Objects;

/**
 * 공간 기록의 before/after 스냅숏(WP-386) — 개인 MemorySnapshot(WP-385)과 같은 역할의 공간판. authorUserId 는 직접 추가·요청한
 * 사람(AI 항목은 null — 발화자를 남기지 않는다). JSON 필드: id·content·origin·authorUserId(null 이면 빠진다 — 다시 읽으면 null
 * 이라 술어는 같다).
 */
public record SharedMemorySnapshot(
    long id,
    String content,
    String origin,
    @JsonInclude(JsonInclude.Include.NON_NULL) Long authorUserId) {

  /** 저장 행 → 스냅숏. */
  public static SharedMemorySnapshot of(Row r) {
    return new SharedMemorySnapshot(r.id(), r.content(), r.origin(), r.authorUserId());
  }

  /** 지금 행이 이 스냅숏과 "그대로"인가 — 같은 id 이고 내용·출처가 같다. 행이 없으면 false. 되돌리기 판정의 유일한 술어다. */
  public boolean sameAs(Row current) {
    return current != null
        && current.id() == id
        && content.equals(current.content())
        && Objects.equals(origin, current.origin());
  }
}
