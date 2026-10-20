// notifTarget 규칙 — 이슈 챗 알림(WP-452)은 챗 드로워(?chat=1)로, 그 외 이슈 알림은 이슈 상세로.
import { describe, expect, it } from 'vitest'

import type { NotificationResponse } from '@/types/notification'

import { isMentionLike, notifTarget } from './notifTarget'

// 테스트용 알림 한 건 — 필요한 필드만 덮어쓴다.
function notif(over: Partial<NotificationResponse>): NotificationResponse {
  return {
    id: 1,
    type: 'COMMENTED',
    actorId: 2,
    actorName: 'AI 개발자',
    actorKind: 'AGENT',
    issueId: 1,
    projectKey: 'WP',
    issueNumber: 452,
    issueTitle: '알림',
    commentId: null,
    eventId: null,
    eventTitle: null,
    eventStartsAt: null,
    read: false,
    createdAt: '2026-10-18T00:00:00Z',
    ...over,
  }
}

describe('notifTarget', () => {
  it('이슈 챗 알림은 이슈 상세 + 챗 드로워로 연다', () => {
    expect(notifTarget(notif({ type: 'AI_QUESTION' }))).toBe('/projects/WP/issues/452?chat=1')
    expect(notifTarget(notif({ type: 'ISSUE_CHAT_MENTION' }))).toBe('/projects/WP/issues/452?chat=1')
  })

  it('그 외 이슈 알림은 이슈 상세 그대로', () => {
    expect(notifTarget(notif({ type: 'COMMENTED' }))).toBe('/projects/WP/issues/452')
    // 코멘트 멘션(WP-650)은 코멘트가 있는 이슈 상세로 — 챗 드로워를 열지 않는다.
    expect(notifTarget(notif({ type: 'ISSUE_COMMENT_MENTION' }))).toBe('/projects/WP/issues/452')
    expect(notifTarget(notif({ type: 'ASSIGNED' }))).toBe('/projects/WP/issues/452')
  })
})

describe('isMentionLike', () => {
  it('이슈 챗 질문·멘션과 코멘트는 나를 호출한 알림', () => {
    expect(isMentionLike(notif({ type: 'AI_QUESTION' }))).toBe(true)
    expect(isMentionLike(notif({ type: 'ISSUE_CHAT_MENTION' }))).toBe(true)
    expect(isMentionLike(notif({ type: 'COMMENTED' }))).toBe(true)
    expect(isMentionLike(notif({ type: 'ISSUE_COMMENT_MENTION' }))).toBe(true)
    expect(isMentionLike(notif({ type: 'STATUS_CHANGED' }))).toBe(false)
  })
})
