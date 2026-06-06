package com.workplace.calendar.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;

/**
 * 일정 생성/수정 요청. endsAt 은 startsAt 보다 뒤여야 한다.
 *
 * @param reminderMinutes 시작 N분 전 리마인더(예: 10·60·1440). null 이면 리마인더 없음(수정 시 기존 리마인더 제거).
 */
public record CalendarEventRequest(
    @NotBlank @Size(max = 200) String title,
    String description,
    @NotNull OffsetDateTime startsAt,
    @NotNull OffsetDateTime endsAt,
    boolean allDay,
    @Size(max = 200) String location,
    @Size(max = 32) String color,
    @Min(0) Integer reminderMinutes) {

  /** 종료가 시작보다 뒤인지 교차 검증 — 위반 시 400. */
  @AssertTrue(message = "endsAt must be after startsAt")
  public boolean isValidRange() {
    return startsAt == null || endsAt == null || endsAt.isAfter(startsAt);
  }
}
