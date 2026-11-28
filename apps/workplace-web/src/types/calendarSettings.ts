// 캘린더 사용자 설정(WP-2169) DTO — 백엔드 /api/v1/calendar/settings 계약과 1:1.

/**
 * 캘린더 사용자 설정 — GET·PUT 응답.
 * defaultCalendarId 는 서버가 해석한 실효값(쓸 수 있는 지정 캘린더, 없으면 Works 캘린더).
 * 웹은 null(테스트 기본·아직 모름)이면 목록의 isDefault 캘린더로 폴백한다.
 */
export interface CalendarSettings {
  defaultCalendarId: number | null
}
