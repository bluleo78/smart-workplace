// 알림 라우팅/표시 공용 유틸 — InboxPanel·알림 위젯·합성 레이어가 공유한다.
// (NotificationsBody 의 로컬 함수를 추출해 규칙이 드리프트되지 않게 단일화.)
import type { NotificationResponse } from '@/types/notification'

/**
 * 캘린더(일정) 기반 알림 판별 — REMINDER/CALENDAR_INVITED/CALENDAR_RSVP_CHANGED/CALENDAR_EVENT_UPDATED 는
 * issueId/projectKey 없이 eventId 만 채워진다(백엔드 insertEventNotification/insertReminder 공통 형태, #489).
 * CALENDAR_EVENT_CANCELED(WP-712)는 지운 일정이라 eventId 도 없다 — 캘린더 첫 화면으로 간다.
 */
export function isCalendarType(n: NotificationResponse): boolean {
  return (
    n.type === 'REMINDER' ||
    n.type === 'CALENDAR_INVITED' ||
    n.type === 'CALENDAR_RSVP_CHANGED' ||
    n.type === 'CALENDAR_EVENT_UPDATED' ||
    n.type === 'CALENDAR_EVENT_CANCELED'
  )
}

/**
 * 이슈 챗에서 생긴 알림 판별(WP-452) — AI 질문·이슈 챗 멘션. 이슈 상세를 챗 드로워가 열린 채로(`?chat=1`,
 * useIssueChatDrawerParam 과 같은 딥링크) 연다. 서버 푸시 url(PushContentService.issueUrl)과 같은 규칙.
 */
export function isIssueChatType(n: NotificationResponse): boolean {
  return n.type === 'AI_QUESTION' || n.type === 'ISSUE_CHAT_MENTION'
}

/**
 * 노트 공유 알림 판별(WP-579) — 공유받음·접근 요청·접근 승인. issueId/eventId 없이 wikiPageId 만 채워진다.
 * 서버 푸시 url(PushContentService.wikiUrl)과 같은 규칙으로 /wiki/open/{pageId} 로 연다.
 */
export function isWikiShareType(n: NotificationResponse): boolean {
  return (
    n.type === 'WIKI_SHARED' ||
    n.type === 'WIKI_SHARE_ACCESS_REQUESTED' ||
    n.type === 'WIKI_SHARE_ACCESS_APPROVED'
  )
}

/**
 * 알림 대상 라우트 해소 — InboxPanel/알림 위젯과 동일 규칙.
 * 캘린더 알림(REMINDER/CALENDAR_INVITED/CALENDAR_RSVP_CHANGED)은 캘린더로, 그 외 이슈 타입은 이슈 상세로.
 * 이슈 챗 알림(AI_QUESTION/ISSUE_CHAT_MENTION)은 이슈 상세 + 챗 드로워(`?chat=1`)로 — 상태 알림(권한 필요·막힘)인 AI_QUESTION 도 같다.
 * AI 작업 검토 요청·실패(AI_REVIEW_REQUESTED/AI_WORK_FAILED, WP-913)는 결과를 볼 이슈 상세 그대로(챗 드로워 없음).
 * 식별 정보가 없으면 인박스 대용(내 작업)으로 폴백(데드 클릭 방지).
 *
 * 캘린더 알림은 메일 알림(`/mail/:accountId?messageId=N`)과 동일 수준으로 해당 일정까지
 * 정밀 딥링크한다 — eventId 를 쿼리파라미터로 실어 CalendarPage 가 소비(#659, 사람 결정).
 * eventId 가 없으면(백엔드가 못 채운 경우) 기존대로 `/calendar` 로 폴백.
 *
 * 노트 공유 알림(WP-579)은 `/wiki/open/{pageId}` — 그 화면이 `GET /wiki/pages/{id}/entry` 로 멤버면 노트로, 공유 대상이면
 * 공유 화면으로 보낸다. 접근 요청은 공유한 사람(스페이스 편집자)이 받으므로 공유 창을 연 채로(`?share=1`).
 */
export function notifTarget(n: NotificationResponse): string {
  if (isWikiShareType(n)) {
    if (n.wikiPageId == null) return '/me/tasks/assigned'
    const base = `/wiki/open/${n.wikiPageId}`
    return n.type === 'WIKI_SHARE_ACCESS_REQUESTED' ? `${base}?share=1` : base
  }
  if (isCalendarType(n)) return n.eventId != null ? `/calendar?eventId=${n.eventId}` : '/calendar'
  if (n.projectKey && n.issueNumber != null) {
    const base = `/projects/${n.projectKey}/issues/${n.issueNumber}`
    return isIssueChatType(n) ? `${base}?chat=1` : base
  }
  return '/me/tasks/assigned'
}

/** 행에 표시할 제목 — 캘린더 알림은 일정 제목, 노트 공유 알림은 노트 제목, 그 외는 이슈 제목. */
export function notifLabel(n: NotificationResponse): string {
  if (isWikiShareType(n)) return n.wikiPageTitle ?? '노트'
  return isCalendarType(n) ? (n.eventTitle ?? '일정 알림') : n.issueTitle
}

/**
 * "나를 호출한" 알림 판별 — 이슈 챗 멘션·AI 질문(WP-452 전용 유형), 코멘트 멘션(WP-650 전용 유형).
 * COMMENTED 는 넣지 않는다 — WP-650 뒤로 멘션된 사람은 ISSUE_COMMENT_MENTION 을 받고, COMMENTED 는 멘션 없는 담당자·워처 공통 알림이다.
 * 예전 멘션 프록시로 남아 일반 댓글이 「멘션」으로 세지고 「지금 신경 쓸 일」에 올랐다(WP-1092). 받은편지함 구분(notifSection)과 같은 기준.
 * 합성 레이어의 멘션 카운트/주의 필요 필터가 동일 규칙을 공유한다(백엔드 PriorityClassificationScheduler 도 같은 규칙).
 */
export function isMentionLike(n: NotificationResponse): boolean {
  return n.type === 'ISSUE_COMMENT_MENTION' || isIssueChatType(n)
}
