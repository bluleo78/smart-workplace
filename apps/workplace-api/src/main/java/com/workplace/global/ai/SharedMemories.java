package com.workplace.global.ai;

import java.util.List;

/** 대화에 싣는 공용 메모리 묶음(WP-386) — moreCount 는 예산 때문에 싣지 못한 개수(「이 밖에 공용 메모리 n개」). */
public record SharedMemories(List<SharedMemoryLine> items, int moreCount) {

  /** 빈 묶음(읽기 실패·대상 없음). */
  public static final SharedMemories EMPTY = new SharedMemories(List.of(), 0);

  /** null(목·구 경로)이면 빈 묶음. */
  public static SharedMemories orEmpty(SharedMemories m) {
    return m == null ? EMPTY : m;
  }
}
