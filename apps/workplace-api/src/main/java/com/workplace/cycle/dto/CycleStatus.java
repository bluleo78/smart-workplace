package com.workplace.cycle.dto;

import com.workplace.cycle.exception.InvalidCycleStatusException;
import java.util.Set;

/** 사이클 상태 화이트리스트. PLANNED → ACTIVE → COMPLETED (전이 강제는 하지 않음). */
public final class CycleStatus {
  private CycleStatus() {}

  /** 진행 중 상태. */
  public static final String ACTIVE = "ACTIVE";

  /** 완료 상태 — 이 상태의 사이클로는 드래그 이동(추가)을 막는다(#881). */
  public static final String COMPLETED = "COMPLETED";

  /** 기본(예정) 상태. */
  public static final String PLANNED = "PLANNED";

  /** 기본 상태 — 상태를 지정하지 않고 만든 사이클은 예정이다. */
  public static final String DEFAULT = PLANNED;

  /** 허용 상태 집합 — 위 상수로 만들어 문자열이 한 곳에만 있게 한다(선언 순서상 상수 뒤에 둔다). */
  public static final Set<String> ALL = Set.of(PLANNED, ACTIVE, COMPLETED);

  /** 허용 상태인지 검증하고 그대로 반환. 아니면 {@link InvalidCycleStatusException}. */
  public static String validate(String status) {
    if (status == null || status.isBlank() || !ALL.contains(status)) {
      throw InvalidCycleStatusException.unknown(status);
    }
    return status;
  }
}
