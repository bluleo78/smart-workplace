package com.workplace.calendar.dto;

/**
 * 사용자 태그 응답(WP-714) — 사이드바 「태그」 묶음 한 줄.
 *
 * @param eventCount 이 태그가 붙은 일정 수(연결 행 수 — M365 반복 회의는 회차마다 행이 따로라 회차 수만큼 센다)
 * @param hasFeed 구독 주소(WP-715)가 발급돼 있는지
 * @param fromOutlook Outlook 범주 동기화로 붙은 일정이 하나라도 있는지 — 그렇다면 이름은 Outlook 에서만 바꾼다(앱에서 바꾸면 409)
 */
public record CalendarTagResponse(
    long id, String name, String color, int eventCount, boolean hasFeed, boolean fromOutlook) {}
