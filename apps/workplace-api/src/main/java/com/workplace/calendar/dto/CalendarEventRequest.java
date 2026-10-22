package com.workplace.calendar.dto;

import com.workplace.global.time.SupportedDateTime;
import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 일정 생성/수정 요청. endsAt 은 startsAt 보다 뒤여야 한다.
 *
 * @param description 설명(선택). 10000자 이하 — 목록 응답에도 실리므로 상한을 둔다.
 * @param reminderMinutes 시작 N분 전 리마인더(예: 10·60·1440). null 이면 리마인더 없음(수정 시 기존 리마인더 제거).
 * @param recurrenceRule RFC5545 RRULE 문자열(예: FREQ=WEEKLY). null 이면 단일(비반복) 일정.
 * @param attendeeUserIds 초대할 참석자 user_id 목록(주최자 제외). null 허용 — 빈 리스트로 정규화.
 * @param calendarId 소속 캘린더 id. null 이면 서버가 기본 캘린더로 resolve.
 */
public record CalendarEventRequest(
    @NotBlank(message = "일정 제목을 입력해 주세요") @Size(max = 200) String title,
    // 상한이 없어 2MB 설명이 저장되고 그 달 목록 응답이 2MB 가 됐다 — 이슈 본문과 같은 10000자(WP-543).
    @Size(max = 10000, message = "설명은 10000자 이하여야 합니다") String description,
    // 시각은 1900~9999년만 — 0년·확장 연도가 저장돼 되돌아오던 것을 막는다(WP-744).
    @NotNull @SupportedDateTime OffsetDateTime startsAt,
    @NotNull @SupportedDateTime OffsetDateTime endsAt,
    boolean allDay,
    @Size(max = 200) String location,
    @Size(max = 32) String color,
    @Min(0) Integer reminderMinutes,
    @Size(max = 500) String recurrenceRule,
    // 같은 id 를 수만 번 넣으면 요청 하나가 수 초 걸렸다(WP-794).
    @Size(max = 500, message = "참석자는 한 번에 500명까지 초대할 수 있습니다") List<Long> attendeeUserIds,
    Long calendarId) {
  public CalendarEventRequest {
    // 제목은 한 줄로 다듬는다 — 제로폭 문자만 있는 제목이 그대로 저장돼 빈 일정처럼 보였다(WP-671, WP-628 후속). 다듬어 비면 위 검증이 한국어로 거절한다
    title = SingleLineTitles.normalize(title);
  }

  /** 종료가 시작보다 뒤인지 교차 검증 — 위반 시 400. */
  @AssertTrue(message = "종료 시각은 시작 시각보다 뒤여야 합니다")
  public boolean isValidRange() {
    return startsAt == null || endsAt == null || endsAt.isAfter(startsAt);
  }

  /** null 을 빈 리스트로 정규화 — 서비스 레이어에서 null-safe 순회에 사용. */
  public List<Long> attendeeUserIdsOrEmpty() {
    return attendeeUserIds == null ? List.of() : attendeeUserIds;
  }
}
