import { describe, expect, it } from 'vitest'

import { isMentionLike } from '@/components/home/notifTarget'
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
    expect(notifSection(notif({ type: 'PRIORITY_CHANGED' }))).toBe('updates')
    expect(notifSection(notif({ type: 'REMINDER' }))).toBe('updates')
  })

  it('이슈 챗 AI 질문·멘션은 내 차례 (WP-452)', () => {
    expect(notifSection(notif({ type: 'AI_QUESTION' }))).toBe('mine')
    expect(notifSection(notif({ type: 'ISSUE_CHAT_MENTION' }))).toBe('mine')
  })

  it('AI 검토 요청·실패는 내 차례 (WP-913)', () => {
    expect(notifSection(notif({ type: 'AI_REVIEW_REQUESTED' }))).toBe('mine')
    expect(notifSection(notif({ type: 'AI_WORK_FAILED' }))).toBe('mine')
  })

  it('코멘트 멘션도 내 차례, 델타는 「코멘트 멘션」 (WP-650)', () => {
    expect(notifSection(notif({ type: 'ISSUE_COMMENT_MENTION' }))).toBe('mine')
    const { mine } = groupNotifications([
      notif({ id: 1, type: 'COMMENTED', createdAt: '2026-06-16T01:00:00Z' }),
      notif({ id: 2, type: 'ISSUE_COMMENT_MENTION', createdAt: '2026-06-16T02:00:00Z' }),
    ])
    expect(mine).toHaveLength(1)
    expect(mine[0].deltaSummary).toBe('코멘트 멘션 · 코멘트 1건')
    expect(mine[0].target).toBe('/projects/WP/issues/7')
  })
})

// 알림 유형 전부 — 유형이 늘면 satisfies 가 컴파일 오류로 알려 아래 판정 표를 함께 고치게 한다(WP-1141).
const ALL_TYPES = Object.keys({
  ASSIGNED: true,
  REPORTER_ASSIGNED: true,
  COMMENTED: true,
  STATUS_CHANGED: true,
  PRIORITY_CHANGED: true,
  REMINDER: true,
  CALENDAR_INVITED: true,
  CALENDAR_RSVP_CHANGED: true,
  AI_QUESTION: true,
  ISSUE_CHAT_MENTION: true,
  ISSUE_COMMENT_MENTION: true,
  WIKI_SHARED: true,
  WIKI_SHARE_ACCESS_REQUESTED: true,
  WIKI_SHARE_ACCESS_APPROVED: true,
  CALENDAR_EVENT_UPDATED: true,
  CALENDAR_EVENT_CANCELED: true,
  AI_REVIEW_REQUESTED: true,
  AI_WORK_FAILED: true,
  PERSONAL_ASSISTANT_REVOKED: true,
} satisfies Record<NotificationResponse['type'], true>) as NotificationResponse['type'][]

describe('멘션 판정과 받은편지함 구역 (WP-1141)', () => {
  it('모든 유형의 받은편지함 구역을 고정한다 — 멘션 없는 일반 댓글(COMMENTED)은 업데이트', () => {
    const mine = ALL_TYPES.filter((type) => notifSection(notif({ type })) === 'mine').sort()
    expect(mine).toEqual(
      [
        'AI_QUESTION',
        'AI_REVIEW_REQUESTED',
        'AI_WORK_FAILED',
        'ASSIGNED',
        'ISSUE_CHAT_MENTION',
        'ISSUE_COMMENT_MENTION',
        'PERSONAL_ASSISTANT_REVOKED',
        'REPORTER_ASSIGNED',
        'WIKI_SHARE_ACCESS_REQUESTED',
      ].sort(),
    )
  })

  it('홈 「멘션」(isMentionLike)으로 세는 유형은 받은편지함에서도 모두 내 차례다 — 두 판정이 갈리지 않는다', () => {
    const mentionTypes = ALL_TYPES.filter((type) => isMentionLike(notif({ type })))
    expect(mentionTypes.sort()).toEqual(['AI_QUESTION', 'ISSUE_CHAT_MENTION', 'ISSUE_COMMENT_MENTION'])
    for (const type of mentionTypes) expect(notifSection(notif({ type })), type).toBe('mine')
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

  it('PRIORITY_CHANGED 는 상태 변경과 대칭적으로 델타에 집계된다 (#613)', () => {
    const { updates } = groupNotifications([
      notif({ id: 1, type: 'PRIORITY_CHANGED', createdAt: '2026-06-16T01:00:00Z' }),
    ])
    expect(updates[0].deltaSummary).toBe('우선순위 변경')

    const { updates: updates2 } = groupNotifications([
      notif({ id: 2, type: 'PRIORITY_CHANGED', createdAt: '2026-06-16T01:00:00Z' }),
      notif({ id: 3, type: 'PRIORITY_CHANGED', createdAt: '2026-06-16T02:00:00Z' }),
    ])
    expect(updates2[0].deltaSummary).toBe('우선순위 변경 2건')
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
    // 알림 딥링크(#659) — 해당 일정 상세를 바로 연다.
    expect(updates[0].target).toBe('/calendar?eventId=5')
  })

  it('CALENDAR_INVITED/CALENDAR_RSVP_CHANGED 도 event 키로 묶고 캘린더로 딥링크한다 (#585)', () => {
    const { updates } = groupNotifications([
      notif({
        id: 10,
        type: 'CALENDAR_INVITED',
        eventId: 6,
        eventTitle: '분기 킥오프',
        issueNumber: 0,
        projectKey: '',
      }),
    ])
    expect(updates[0].key).toBe('event:6')
    expect(updates[0].title).toBe('분기 킥오프')
    expect(updates[0].deltaSummary).toBe('일정 초대')
    expect(updates[0].target).toBe('/calendar?eventId=6')

    const { updates: updates2 } = groupNotifications([
      notif({
        id: 11,
        type: 'CALENDAR_RSVP_CHANGED',
        eventId: 7,
        eventTitle: '주간 회의',
        issueNumber: 0,
        projectKey: '',
      }),
    ])
    expect(updates2[0].key).toBe('event:7')
    expect(updates2[0].deltaSummary).toBe('참석 응답 변경')
    expect(updates2[0].target).toBe('/calendar?eventId=7')
  })

  it('일정 변경은 그 일정으로 딥링크하고, 일정 취소는 일정이 없어 알림마다 따로 두고 캘린더로 간다 (WP-712)', () => {
    const { updates } = groupNotifications([
      notif({
        id: 20,
        type: 'CALENDAR_EVENT_UPDATED',
        eventId: 8,
        eventTitle: '주간 회의',
        issueNumber: 0,
        projectKey: '',
        createdAt: '2026-06-16T02:00:00Z',
      }),
      notif({
        id: 21,
        type: 'CALENDAR_EVENT_CANCELED',
        eventId: null,
        eventTitle: '분기 리뷰',
        issueNumber: 0,
        projectKey: '',
        createdAt: '2026-06-16T01:00:00Z',
      }),
    ])
    expect(updates.map((g) => g.key)).toEqual(['event:8', 'id:21'])
    expect(updates[0].deltaSummary).toBe('일정 변경')
    expect(updates[0].target).toBe('/calendar?eventId=8')
    expect(updates[1].title).toBe('분기 리뷰')
    expect(updates[1].deltaSummary).toBe('일정 취소')
    expect(updates[1].target).toBe('/calendar')
  })

  it('이슈 챗 알림은 내 차례로 묶고, 델타를 따로 세고, 챗 드로워로 딥링크한다 (WP-452)', () => {
    const { mine, updates } = groupNotifications([
      notif({ id: 1, type: 'COMMENTED', createdAt: '2026-06-16T01:00:00Z' }),
      notif({ id: 2, type: 'AI_QUESTION', actorKind: 'AGENT', createdAt: '2026-06-16T02:00:00Z' }),
      notif({ id: 3, type: 'ISSUE_CHAT_MENTION', createdAt: '2026-06-16T03:00:00Z' }),
      notif({ id: 4, type: 'ISSUE_CHAT_MENTION', createdAt: '2026-06-16T04:00:00Z' }),
    ])
    expect(updates).toHaveLength(0)
    expect(mine).toHaveLength(1)
    // 마지막 else 폴백('일정 알림')으로 새지 않는다.
    expect(mine[0].deltaSummary).toBe('AI 질문 · 멘션 2건 · 코멘트 1건')
    expect(mine[0].target).toBe('/projects/WP/issues/7?chat=1')
    expect(mine[0].hasAgent).toBe(true)
  })

  it('노트 공유 알림은 노트·유형별로 묶고 접근 요청은 내 차례로, 이슈 키가 새지 않는다 (WP-579)', () => {
    const wiki = (over: Partial<NotificationResponse>) =>
      notif({ projectKey: '', issueNumber: 0, issueTitle: '', wikiPageId: 77, wikiPageTitle: '제품 로드맵', ...over })
    const { mine, updates } = groupNotifications([
      wiki({ id: 1, type: 'WIKI_SHARE_ACCESS_REQUESTED', createdAt: '2026-06-16T01:00:00Z' }),
      wiki({ id: 2, type: 'WIKI_SHARED', createdAt: '2026-06-16T02:00:00Z' }),
      wiki({ id: 3, type: 'WIKI_SHARED', wikiPageId: 88, wikiPageTitle: '회의록', createdAt: '2026-06-16T03:00:00Z' }),
    ])
    expect(mine).toHaveLength(1)
    expect(mine[0].title).toBe('제품 로드맵')
    expect(mine[0].target).toBe('/wiki/open/77?share=1')
    expect(mine[0].deltaSummary).toBe('접근 요청')
    expect(updates).toHaveLength(2)
    expect(updates[0].title).toBe('회의록')
    expect(updates[0].target).toBe('/wiki/open/88')
    expect(updates[1].target).toBe('/wiki/open/77')
  })

  it('개인 비서 연결 해제는 내 차례로 한 줄에 묶고, 이슈 키 없이 「개인 비서」·내 비서 설정으로 간다 (WP-1170)', () => {
    const revoked = (over: Partial<NotificationResponse>) =>
      notif({ type: 'PERSONAL_ASSISTANT_REVOKED', projectKey: '', issueNumber: 0, issueTitle: '', ...over })
    const { mine, updates } = groupNotifications([
      revoked({ id: 1, actorName: '김관리', createdAt: '2026-06-16T01:00:00Z' }),
      revoked({ id: 2, actorId: null, actorName: null, actorKind: null, createdAt: '2026-06-16T02:00:00Z' }),
    ])
    expect(updates).toHaveLength(0)
    expect(mine).toHaveLength(1)
    expect(mine[0].title).toBe('개인 비서')
    expect(mine[0].label).toBe('개인 비서')
    expect(mine[0].target).toBe('/settings/assistant')
    expect(mine[0].deltaSummary).toBe('개인 비서 연결 해제 2건')
    expect(mine[0].repType).toBe('PERSONAL_ASSISTANT_REVOKED')
  })

  it('AI 검토 요청·실패는 내 차례로 묶고 델타를 따로 센다, 이슈 상세로 딥링크한다 (WP-913)', () => {
    const review = groupNotifications([
      notif({ id: 1, type: 'AI_REVIEW_REQUESTED', actorKind: 'AGENT', agentWorkState: 'REVIEW' }),
    ])
    expect(review.updates).toHaveLength(0)
    expect(review.mine[0].deltaSummary).toBe('검토 요청')
    expect(review.mine[0].target).toBe('/projects/WP/issues/7')

    const failed = groupNotifications([
      notif({ id: 1, type: 'AI_WORK_FAILED', actorKind: 'AGENT', agentWorkState: 'FAILED', createdAt: '2026-06-16T01:00:00Z' }),
      notif({ id: 2, type: 'AI_WORK_FAILED', actorKind: 'AGENT', agentWorkState: 'REJECTED', createdAt: '2026-06-16T02:00:00Z' }),
    ])
    expect(failed.mine).toHaveLength(1)
    expect(failed.mine[0].deltaSummary).toBe('AI 실패 2건')
  })
})
