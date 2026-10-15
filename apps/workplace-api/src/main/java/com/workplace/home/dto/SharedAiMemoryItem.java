package com.workplace.home.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/**
 * 공용 메모리 한 건(WP-386). author 는 직접 추가·요청한 사람만(대화에서 뽑힌 항목·AI 정리는 없음 — 발화자 추적 금지). canEdit 은 지금 사용자가
 * 고치고 지울 수 있는가.
 */
public record SharedAiMemoryItem(
    long id,
    String content,
    String origin,
    @JsonInclude(JsonInclude.Include.NON_NULL) Author author,
    Instant createdAt,
    Instant updatedAt,
    boolean canEdit) {

  /** 작성자 표시. */
  public record Author(String name) {}
}
