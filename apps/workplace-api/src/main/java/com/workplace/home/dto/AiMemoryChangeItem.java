package com.workplace.home.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.home.service.MemorySnapshot;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 「AI가 정리한 기록」 1건(WP-385 스펙 8.1). memory 는 결과 스냅숏(FORGOTTEN·DECAYED 는 null — 화면은 before[0] 을
 * 취소선으로), before 는 원본 스냅숏 배열(ADDED 는 빈 배열, MERGED 는 합친 원본들). source 는 출처 대화(딥링크 /?aiChat=&lt;id&gt;
 * — 대화가 지워졌으면 빠짐), reason 은 모델이 준 짧은 사유(보조 문구 — 화면 문구는 action 으로 만든다). undoneAt 은 되돌린 시각(아니면 null).
 */
public record AiMemoryChangeItem(
    long id,
    String action,
    Instant createdAt,
    MemorySnapshot memory,
    List<MemorySnapshot> before,
    @JsonInclude(JsonInclude.Include.NON_NULL) SourceSession source,
    @JsonInclude(JsonInclude.Include.NON_NULL) String reason,
    Instant undoneAt) {

  /** 출처 대화 — 제목이 없으면 null. */
  public record SourceSession(UUID id, String title) {}
}
