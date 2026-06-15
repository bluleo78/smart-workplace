// 알림 라우팅/표시 공용 유틸 — InboxPanel·알림 위젯·합성 레이어가 공유한다.
// (NotificationsBody 의 로컬 함수를 추출해 규칙이 드리프트되지 않게 단일화.)
import type { NotificationResponse } from '@/types/notification'

/**
 * 알림 대상 라우트 해소 — InboxPanel/알림 위젯과 동일 규칙.
 * REMINDER(일정 알림)는 캘린더로, 그 외 이슈 타입은 이슈 상세로.
 * 식별 정보가 없으면 인박스 대용(내 작업)으로 폴백(데드 클릭 방지).
 */
export function notifTarget(n: NotificationResponse): string {
  if (n.type === 'REMINDER') return '/calendar'
  if (n.projectKey && n.issueNumber != null)
    return `/projects/${n.projectKey}/issues/${n.issueNumber}`
  return '/me/tasks/assigned'
}

/** 행에 표시할 제목 — REMINDER 는 일정 제목, 그 외는 이슈 제목. */
export function notifLabel(n: NotificationResponse): string {
  return n.type === 'REMINDER' ? (n.eventTitle ?? '일정 알림') : n.issueTitle
}

/**
 * "나를 호출한" 알림 판별 — 전용 MENTION 타입이 없어 COMMENTED(코멘트)를 멘션 프록시로 사용.
 * (백엔드 NotificationType: ASSIGNED|COMMENTED|STATUS_CHANGED|REMINDER — 멘션 타입 부재.)
 * 합성 레이어의 멘션 카운트/주의 필요 필터가 동일 규칙을 공유한다.
 */
export function isMentionLike(n: NotificationResponse): boolean {
  return n.type === 'COMMENTED'
}
