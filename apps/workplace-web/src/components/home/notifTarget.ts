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
 * 이슈 챗에서 생긴 알림 판별(WP-452) — AI 질문·이슈 챗 멘션. 이슈 상세를 챗 드로워가 열린 채로(`?chat=1`,
 * useIssueChatDrawerParam 과 같은 딥링크) 연다. 서버 푸시 url(PushContentService.issueUrl)과 같은 규칙.
 */
export function isIssueChatType(n: NotificationResponse): boolean {
  return n.type === 'AI_QUESTION' || n.type === 'ISSUE_CHAT_MENTION'
}

/**
 * 알림 대상 라우트 해소 — InboxPanel/알림 위젯과 동일 규칙.
 * 캘린더 알림(REMINDER/CALENDAR_INVITED/CALENDAR_RSVP_CHANGED)은 캘린더로, 그 외 이슈 타입은 이슈 상세로.
 * 이슈 챗 알림(AI_QUESTION/ISSUE_CHAT_MENTION)은 이슈 상세 + 챗 드로워(`?chat=1`)로.
 * 식별 정보가 없으면 인박스 대용(내 작업)으로 폴백(데드 클릭 방지).
 *
 * 캘린더 알림은 메일 알림(`/mail/:accountId?messageId=N`)과 동일 수준으로 해당 일정까지
 * 정밀 딥링크한다 — eventId 를 쿼리파라미터로 실어 CalendarPage 가 소비(#659, 사람 결정).
 * eventId 가 없으면(백엔드가 못 채운 경우) 기존대로 `/calendar` 로 폴백.
 */
export function notifTarget(n: NotificationResponse): string {
  if (isCalendarType(n)) return n.eventId != null ? `/calendar?eventId=${n.eventId}` : '/calendar'
  if (n.projectKey && n.issueNumber != null) {
    const base = `/projects/${n.projectKey}/issues/${n.issueNumber}`
    return isIssueChatType(n) ? `${base}?chat=1` : base
  }
  return '/me/tasks/assigned'
}

/** 행에 표시할 제목 — 캘린더 알림은 일정 제목, 그 외는 이슈 제목. */
export function notifLabel(n: NotificationResponse): string {
  return isCalendarType(n) ? (n.eventTitle ?? '일정 알림') : n.issueTitle
}

/**
 * "나를 호출한" 알림 판별 — 이슈 챗 멘션·AI 질문(WP-452 전용 유형), 코멘트 멘션(WP-650 전용 유형), 그리고 멘션 프록시로 쓰던 COMMENTED.
 * 합성 레이어의 멘션 카운트/주의 필요 필터가 동일 규칙을 공유한다(백엔드 PriorityClassificationScheduler 도 같은 규칙).
 */
export function isMentionLike(n: NotificationResponse): boolean {
  return n.type === 'COMMENTED' || n.type === 'ISSUE_COMMENT_MENTION' || isIssueChatType(n)
}
