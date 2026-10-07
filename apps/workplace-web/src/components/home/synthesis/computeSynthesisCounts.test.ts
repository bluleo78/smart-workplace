// computeSynthesisCounts(WP-161) — 데스크톱·모바일 요약 KPI 5종이 함께 쓰는 집계 규칙 단위 테스트.
import { describe, expect, it } from 'vitest'

import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'
import type { MailSummary, MessagingSummary } from '@/types/dashboard'
import type { NotificationResponse } from '@/types/notification'

import { computeSynthesisCounts } from './computeSynthesisCounts'

const TODAY = '2026-10-07'

function due(dueDate: string, issueId = 1): IssueDueMarker {
  return { issueId, projectKey: 'WP', number: issueId, title: `이슈 ${issueId}`, dueDate }
}

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

function mail(over: Partial<MailSummary>): MailSummary {
  return { unreadCount: 7, needsReplyCount: 2, classificationActive: false, recent: [], ...over }
}

function messaging(attentionCount: number): MessagingSummary {
  // needsReply + aiAttention 합(5)과 다른 값을 줘서 dedup 단일값(attentionCount)을 쓰는지 확인한다.
  return { unreadConversationCount: 9, needsReplyCount: 3, aiAttentionCount: 2, attentionCount, recent: [] }
}

const empty = { dues: [], notifications: [], mail: undefined, events: [], messaging: undefined, todayKey: TODAY }

describe('computeSynthesisCounts', () => {
  it('데이터가 없으면(로딩 전) 모든 칸 0, 메일 분류는 꺼짐', () => {
    expect(computeSynthesisCounts(empty)).toEqual({
      dueToday: 0,
      mention: 0,
      mail: 0,
      event: 0,
      chat: 0,
      classifyOn: false,
    })
  })

  it('오늘 마감은 마감일이 오늘인 것만 센다(지난 마감·미래 마감 제외)', () => {
    const r = computeSynthesisCounts({
      ...empty,
      dues: [due(TODAY, 1), due(TODAY, 2), due('2026-10-06', 3), due('2026-10-08', 4)],
    })
    expect(r.dueToday).toBe(2)
  })

  it('멘션은 안 읽은 COMMENTED 만 센다', () => {
    const r = computeSynthesisCounts({
      ...empty,
      notifications: [
        notif({ id: 1 }),
        notif({ id: 2, read: true }),
        notif({ id: 3, type: 'ASSIGNED' as NotificationResponse['type'] }),
        notif({ id: 4 }),
      ],
    })
    expect(r.mention).toBe(2)
  })

  it('메일은 분류 꺼짐이면 안 읽음, 켜짐이면 회신 필요 건수로 스왑한다', () => {
    expect(computeSynthesisCounts({ ...empty, mail: mail({}) })).toMatchObject({ mail: 7, classifyOn: false })
    expect(computeSynthesisCounts({ ...empty, mail: mail({ classificationActive: true }) })).toMatchObject({
      mail: 2,
      classifyOn: true,
    })
  })

  it('오늘 일정은 조회 결과 길이, 메시징은 attentionCount 단일값', () => {
    const r = computeSynthesisCounts({
      ...empty,
      events: [{} as CalendarEvent, {} as CalendarEvent, {} as CalendarEvent],
      messaging: messaging(4),
    })
    expect(r.event).toBe(3)
    expect(r.chat).toBe(4)
  })
})
