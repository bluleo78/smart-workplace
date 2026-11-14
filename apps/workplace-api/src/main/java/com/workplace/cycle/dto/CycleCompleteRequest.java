package com.workplace.cycle.dto;

import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;

/**
 * 사이클 완료 요청 본문(WP-1578). 세 가지 목적지 중 하나를 지정한다.
 *
 * <p>NEW: 새 사이클 생성 후 미완료 이슈를 거기 Attach. 새 사이클 정보(name 필수, 기간은 선택)를 본문에 포함.
 *
 * <p>SCHEDULED: 기존 예정 사이클로 이동. targetCycleId 로 대상을 지정하고, startImmediately=true 면 대상을 ACTIVE 로 만든다.
 *
 * <p>NONE: 사이클만 완료. 미완료 이슈는 백로그에 남는다.
 */
public record CycleCompleteRequest(
    /** 목적지 종류: NEW | SCHEDULED | NONE */
    @NotNull(message = "destination은 필수입니다(NEW|SCHEDULED|NONE)") Destination destination,

    /** SCHEDULED 일 때 필수 */
    Long targetCycleId,

    /** SCHEDULED·NEW 일 때 미완료 이슈 수 (요약용, 검증 없음) */
    Integer incompleteCount,

    /** SCHEDULED: 대상 사이클을 즉시 ACTIVE 로 만들지 여부. 미지정 시 true. */
    Boolean startImmediately,

    /** NEW 일 때 새 사이클 이름. 필수. */
    String newCycleName,

    /** NEW 일 때 새 사이클 시작일. 필수. */
    LocalDate newCycleStartDate,

    /** NEW 일 때 새 사이클 종료일. 선택. */
    LocalDate newCycleEndDate) {

  /** 목적지 종류 열거. */
  public enum Destination {
    /** 새 사이클을 생성해서 미완료 이슈를 거기 Attach. */
    NEW,

    /** 기존 예정 사이클로 이동. */
    SCHEDULED,

    /** 사이클만 완료 — 미완료 이슈는 백로그에 남는다. */
    NONE
  }

  /** 새 사이클 목적지일 때 이름이 비어 있지 않은지 검증. */
  public void validateNewCycle() {
    if (destination == Destination.NEW) {
      if (newCycleName == null || newCycleName.isBlank()) {
        throw new IllegalArgumentException("새 사이클 목적지에는 이름이 필요합니다");
      }
      if (newCycleStartDate == null) {
        throw new IllegalArgumentException("새 사이클 목적지에는 시작일이 필요합니다");
      }
    }
  }

  /** 예정 사이클 목적지일 때 targetCycleId 가 있는지 검증. */
  public void validateScheduledCycle() {
    if (destination == Destination.SCHEDULED && targetCycleId == null) {
      throw new IllegalArgumentException("예정 사이클 목적지에는 targetCycleId가 필요합니다");
    }
  }
}
