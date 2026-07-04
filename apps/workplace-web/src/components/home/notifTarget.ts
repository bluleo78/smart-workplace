// 알림 라우팅/표시 공용 유틸 — InboxPanel·알림 위젯·합성 레이어가 공유한다.
// (NotificationsBody 의 로컬 함수를 추출해 규칙이 드리프트되지 않게 단일화.)
import type { NotificationResponse } from '@/types/notification'

/**
 * 캘린더(일정) 기반 알림 판별 — REMINDER/CALENDAR_INVITED/CALENDAR_RSVP_CHANGED 는
 * issueId/projectKey 없이 eventId 만 채워진다(백엔드 insertEventNotification/insertReminder 공통 형태, #489).
 */
export function isCalendarType(n: NotificationResponse): boolean {
  return n.type === 'REMINDER' || n.type === 'CALENDAR_INVITED' || n.type === 'CALENDAR_RSVP_CHANGED'
}

/**
 * 알림 대상 라우트 해소 — InboxPanel/알림 위젯과 동일 규칙.
 * 캘린더 알림(REMINDER/CALENDAR_INVITED/CALENDAR_RSVP_CHANGED)은 캘린더로, 그 외 이슈 타입은 이슈 상세로.
 * 식별 정보가 없으면 인박스 대용(내 작업)으로 폴백(데드 클릭 방지).
 */
export function notifTarget(n: NotificationResponse): string {
  if (isCalendarType(n)) return '/calendar'
  if (n.projectKey && n.issueNumber != null)
    return `/projects/${n.projectKey}/issues/${n.issueNumber}`
  return '/me/tasks/assigned'
}

/** 행에 표시할 제목 — 캘린더 알림은 일정 제목, 그 외는 이슈 제목. */
export function notifLabel(n: NotificationResponse): string {
  return isCalendarType(n) ? (n.eventTitle ?? '일정 알림') : n.issueTitle
}

/**
 * "나를 호출한" 알림 판별 — 전용 MENTION 타입이 없어 COMMENTED(코멘트)를 멘션 프록시로 사용.
 * (백엔드 NotificationType: ASSIGNED|COMMENTED|STATUS_CHANGED|PRIORITY_CHANGED|REMINDER — 멘션 타입 부재.)
 * 합성 레이어의 멘션 카운트/주의 필요 필터가 동일 규칙을 공유한다.
 */
export function isMentionLike(n: NotificationResponse): boolean {
  return n.type === 'COMMENTED'
}
