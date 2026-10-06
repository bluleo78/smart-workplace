// groupMentionNotifs(WP-258) — 같은 이슈 멘션 알림 묶기 규칙 단위 테스트.
import { describe, expect, it } from 'vitest'

import type { NotificationResponse } from '@/types/notification'

import { groupMentionNotifs } from './groupMentions'

// 테스트용 알림 — 기본은 WP-1 이슈의 안 읽은 COMMENTED.
function notif(over: Partial<NotificationResponse>): NotificationResponse {
  return {
    id: 1,
    type: 'COMMENTED',
    actorId: 2,
    actorName: '김개발',
    actorKind: 'HUMAN',
    issueId: 10,
    projectKey: 'WP',
    issueNumber: 1,
    issueTitle: '이슈 A',
    commentId: null,
    eventId: null,
    eventTitle: null,
    eventStartsAt: null,
    read: false,
    createdAt: '2026-10-05T01:00:00Z',
    ...over,
  }
}

describe('groupMentionNotifs', () => {
  it('같은 이슈 알림은 한 묶음으로, 최신 알림을 대표로 삼는다', () => {
    const groups = groupMentionNotifs([
      notif({ id: 1, createdAt: '2026-10-05T01:00:00Z' }),
      notif({ id: 2, createdAt: '2026-10-05T03:00:00Z', issueTitle: '이슈 A(제목변경)' }),
      notif({ id: 3, createdAt: '2026-10-05T02:00:00Z' }),
      notif({ id: 4, issueId: 20, issueNumber: 2, issueTitle: '이슈 B' }),
    ])
    expect(groups.map((g) => [g.to, g.items.length, g.latest.id])).toEqual([
      ['/projects/WP/issues/1', 3, 2],
      ['/projects/WP/issues/2', 1, 4],
    ])
  })

  it('최신 판정은 시각 기준 — 소수초 자릿수가 달라도 문자열 사전순에 속지 않는다', () => {
    const [g] = groupMentionNotifs([
      notif({ id: 1, createdAt: '2026-10-05T01:00:00Z' }),
      notif({ id: 2, createdAt: '2026-10-05T01:00:00.5Z' }),
    ])
    expect(g.latest.id).toBe(2)
  })

  it('읽은 알림·멘션이 아닌 알림은 제외한다', () => {
    const groups = groupMentionNotifs([
      notif({ id: 1, read: true }),
      notif({ id: 2, type: 'ASSIGNED' }),
      notif({ id: 3 }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((n) => n.id)).toEqual([3])
  })

  it('다른 프로젝트의 같은 번호 이슈는 섞지 않는다', () => {
    const groups = groupMentionNotifs([notif({ id: 1 }), notif({ id: 2, projectKey: 'OPS' })])
    expect(groups).toHaveLength(2)
  })
})
