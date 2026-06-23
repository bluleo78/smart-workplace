import { describe, expect, it } from 'vitest'

import type { NotificationResponse } from '@/types/notification'

import { groupNotifications, notifSection } from './notifGrouping'

// 테스트용 알림 한 건 생성 — 필요한 필드만 덮어쓴다.
function notif(over: Partial<NotificationResponse>): NotificationResponse {
  return {
    id: 1,
    type: 'COMMENTED',
    actorId: 2,
    actorName: '양동희',
    actorKind: 'HUMAN',
    issueId: 1,
    projectKey: 'WP',
    issueNumber: 7,
    issueTitle: '리뷰 요청 이슈',
    commentId: null,
    eventId: null,
    eventTitle: null,
    eventStartsAt: null,
    read: false,
    createdAt: '2026-06-16T00:00:00Z',
    ...over,
  }
}

describe('notifSection', () => {
  it('ASSIGNED 는 내 차례, 나머지는 업데이트', () => {
    expect(notifSection(notif({ type: 'ASSIGNED' }))).toBe('mine')
    expect(notifSection(notif({ type: 'COMMENTED' }))).toBe('updates')
    expect(notifSection(notif({ type: 'STATUS_CHANGED' }))).toBe('updates')
    expect(notifSection(notif({ type: 'REMINDER' }))).toBe('updates')
  })
})

describe('groupNotifications', () => {
  it('같은 이슈의 여러 알림을 한 그룹으로 묶고 델타를 집계한다', () => {
    const { updates } = groupNotifications([
      notif({ id: 1, type: 'COMMENTED', createdAt: '2026-06-16T01:00:00Z' }),
      notif({ id: 2, type: 'COMMENTED', createdAt: '2026-06-16T02:00:00Z' }),
      notif({ id: 3, type: 'STATUS_CHANGED', createdAt: '2026-06-16T03:00:00Z' }),
    ])
    expect(updates).toHaveLength(1)
    expect(updates[0].key).toBe('issue:WP-7')
    expect(updates[0].deltaSummary).toBe('코멘트 2건 · 상태 변경')
    expect(updates[0].count).toBe(3)
    expect(updates[0].unreadIds).toEqual([1, 2, 3])
    expect(updates[0].latestAt).toBe('2026-06-16T03:00:00Z')
  })

  it('그룹에 ASSIGNED 가 있으면 내 차례로 분류한다', () => {
    const { mine, updates } = groupNotifications([
      notif({ id: 1, type: 'COMMENTED' }),
      notif({ id: 2, type: 'ASSIGNED' }),
    ])
    expect(mine).toHaveLength(1)
    expect(updates).toHaveLength(0)
    expect(mine[0].section).toBe('mine')
  })

  it('표시 제목과 딥링크 라벨을 분리한다', () => {
    const { mine } = groupNotifications([notif({ type: 'ASSIGNED' })])
    expect(mine[0].title).toBe('WP-7 · 리뷰 요청 이슈')
    expect(mine[0].label).toBe('리뷰 요청 이슈')
    expect(mine[0].target).toBe('/projects/WP/issues/7')
  })

  it('AGENT 행위자가 있으면 hasAgent=true, 모두 읽음이면 read=true', () => {
    const { updates } = groupNotifications([
      notif({ id: 1, actorKind: 'AGENT', read: true }),
    ])
    expect(updates[0].hasAgent).toBe(true)
    expect(updates[0].read).toBe(true)
    expect(updates[0].unreadIds).toEqual([])
  })

  it('REMINDER 는 event 키로 묶고 일정 제목을 쓴다', () => {
    const { updates } = groupNotifications([
      notif({ id: 9, type: 'REMINDER', eventId: 5, eventTitle: '주간 회의', issueNumber: 0, projectKey: '' }),
    ])
    expect(updates[0].key).toBe('event:5')
    expect(updates[0].title).toBe('주간 회의')
    expect(updates[0].deltaSummary).toBe('일정 알림')
    expect(updates[0].target).toBe('/calendar')
  })
})
