package com.workplace.calendar.dto;

import com.workplace.global.time.SupportedDateTime;
import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
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
 * @param tagIds 이 일정에 붙일 내 태그 id(WP-801) — null 이면 태그를 건드리지 않는다(MCP·AI 등 태그를 모르는 호출자). 빈 목록이면 내 태그를
 *     모두 뗀다. 태그는 시리즈 단위라 반복 일정은 범위와 상관없이 그 시리즈 마스터에 붙는다(「이후 모든 일정」이면 새로 나뉜 시리즈). 상한·판정은 {@code PUT
 *     /events/{id}/tags}(EventTagsRequest)와 같다 — 남의 태그 404, 범주를 써 넣을 수 없는 M365 일정 409(일정을 쓰기 전에 확인해
 *     일정도 바뀌지 않는다). M365 일정은 일정을 쓴 뒤 Outlook 범주로 써 넣는다.
 */
public record CalendarEventRequest(
    @NotBlank(message = "일정 제목을 입력해 주세요") @Size(max = 200) String title,
    // 상한이 없어 2MB 설명이 저장되고 그 달 목록 응답이 2MB 가 됐다 — 10000자로 둔다(WP-543, 이슈 본문 상한과는 별개).
    @Size(max = 10000, message = "설명은 10000자 이하여야 합니다") String description,
    // 시각은 1900~9999년만 — 0년·확장 연도가 저장돼 되돌아오던 것을 막는다(WP-744).
    @NotNull @SupportedDateTime OffsetDateTime startsAt,
    @NotNull @SupportedDateTime OffsetDateTime endsAt,
    boolean allDay,
    @Size(max = 200) String location,
    @Size(max = 32) String color,
    // 상한 4주(40320분, 구글 캘린더와 같은 한도) — 없으면 몇 년 앞선 리마인더가 저장돼 일정 등록 직후 알림이 나갔다(WP-799).
    @Min(0) @Max(value = 40320, message = "리마인더는 일정 4주 전까지만 설정할 수 있습니다") Integer reminderMinutes,
    @Size(max = 500) String recurrenceRule,
    // 같은 id 를 수만 번 넣으면 요청 하나가 수 초 걸렸다(WP-794).
    @Size(max = 500, message = "참석자는 한 번에 500명까지 초대할 수 있습니다") List<Long> attendeeUserIds,
    Long calendarId,
    @Size(max = 50) List<Long> tagIds) {
  public CalendarEventRequest {
    // 제목은 한 줄로 다듬는다 — 제로폭 문자만 있는 제목이 그대로 저장돼 빈 일정처럼 보였다(WP-671, WP-628 후속). 다듬어 비면 위 검증이 한국어로 거절한다
    title = SingleLineTitles.normalize(title);
  }

  /**
   * 태그 없이 만드는 생성자 — 태그를 보내지 않는 서버 내부 호출자(테스트·AI 확인 카드 등)용. tagIds=null 이라 태그를 건드리지 않는다. JSON 역직렬화는
   * 레코드의 표준 생성자를 쓴다.
   */
  public CalendarEventRequest(
      String title,
      String description,
      OffsetDateTime startsAt,
      OffsetDateTime endsAt,
      boolean allDay,
      String location,
      String color,
      Integer reminderMinutes,
      String recurrenceRule,
      List<Long> attendeeUserIds,
      Long calendarId) {
    this(
        title,
        description,
        startsAt,
        endsAt,
        allDay,
        location,
        color,
        reminderMinutes,
        recurrenceRule,
        attendeeUserIds,
        calendarId,
        null);
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
