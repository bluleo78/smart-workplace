package com.workplace.home.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.home.service.SharedMemorySnapshot;
import java.time.Instant;
import java.util.List;

/**
 * 공간 기록 한 줄(WP-386). actor.name 은 사람일 때만(AI 는 없음). memory 는 결과(지움이면 null), before 는 바뀌기 전. 출처 대화
 * 링크는 두지 않는다(발화자 추적 금지). undoable 은 지금 사용자가 되돌릴 수 있는가.
 */
public record SharedAiMemoryChangeItem(
    long id,
    String action,
    Actor actor,
    Instant createdAt,
    SharedMemorySnapshot memory,
    List<SharedMemorySnapshot> before,
    Instant undoneAt,
    boolean undoable) {

  /** 행위자 — kind USER·AI. */
  public record Actor(String kind, @JsonInclude(JsonInclude.Include.NON_NULL) String name) {}
}
