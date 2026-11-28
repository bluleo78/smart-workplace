// 캘린더 사용자 설정(WP-2169) DTO — 백엔드 /api/v1/calendar/settings 계약과 1:1.

/**
 * 캘린더 사용자 설정 — GET·PUT 응답.
 * defaultCalendarId 는 서버가 해석한 실효값(쓸 수 있는 지정 캘린더, 없으면 Works 캘린더).
 * 웹은 null(테스트 기본·아직 모름)이면 목록의 isDefault 캘린더로 폴백한다.
 */
export interface CalendarSettings {
  defaultCalendarId: number | null
  /** Outlook 기본 캘린더 물었음(WP-2171) — false 일 때만 확인 창 후보. 서버 이전 응답·테스트 기본에는 없을 수 있다 */
  outlookPrompted?: boolean
}
