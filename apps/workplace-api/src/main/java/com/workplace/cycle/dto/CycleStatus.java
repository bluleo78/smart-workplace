package com.workplace.cycle.dto;

import com.workplace.cycle.exception.InvalidCycleStatusException;
import java.util.Set;

/** 사이클 상태 화이트리스트. PLANNED → ACTIVE → COMPLETED (전이 강제는 하지 않음). */
public final class CycleStatus {
  private CycleStatus() {}

  /** 허용 상태 집합. */
  public static final Set<String> ALL = Set.of("PLANNED", "ACTIVE", "COMPLETED");

  /** 기본 상태. */
  public static final String DEFAULT = "PLANNED";

  /** 허용 상태인지 검증하고 그대로 반환. 아니면 {@link InvalidCycleStatusException}. */
  public static String validate(String status) {
    if (status == null || status.isBlank() || !ALL.contains(status)) {
      throw new InvalidCycleStatusException(status);
    }
    return status;
  }
}
