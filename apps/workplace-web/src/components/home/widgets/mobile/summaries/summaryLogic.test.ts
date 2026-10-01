// 모바일 요약 한 줄의 선택 규칙(WP-142) — 접힘·타일에 "무엇을 보일지"를 결정적으로 고정한다. TZ=Asia/Seoul.
import { describe, expect, it } from 'vitest'

import type { PriorityItem } from '@/api/priorityItems'
import type { CalendarEvent } from '@/types/calendar'
import type { MailSummary, MailSummaryItem } from '@/types/dashboard'
import type { ChannelResponse } from '@/types/messaging'
import type { NotificationResponse } from '@/types/notification'

import {
  eventTimeLabel,
  joinNames,
  latestUnreadNotification,
  mailBadgeCount,
  mailSender,
  pickBusiestChannel,
  pickLatestMail,
  pickNextEvent,
  quadrantLabel,
  topPriorityItem,
  totalUnread,
} from './summaryLogic'

function ev(id: number, startsAt: string, allDay = false): CalendarEvent {
  return {
    id,
    title: `일정${id}`,
    description: null,
    startsAt,
    endsAt: startsAt,
    allDay,
    location: null,
    color: null,
    reminderMinutes: null,
    recurrenceRule: null,
    calendarId: 1,
    calendarName: '내 캘린더',
    effectiveColor: '#3b82f6',
    createdAt: startsAt,
    updatedAt: startsAt,
  } as CalendarEvent
}

const NOW = new Date('2026-10-01T03:00:00Z') // KST 12:00

describe('pickNextEvent', () => {
  it('지금 이후 시작하는 시각 일정 중 가장 이른 것', () => {
    const events = [ev(1, '2026-10-01T07:00:00Z'), ev(2, '2026-10-01T02:00:00Z'), ev(3, '2026-10-01T05:30:00Z')]
    expect(pickNextEvent(events, NOW)?.id).toBe(3)
    expect(eventTimeLabel(pickNextEvent(events, NOW)!)).toBe('14:30')
  })
  it('남은 시각 일정이 없으면 종일 일정, 그것도 없으면 null', () => {
    expect(pickNextEvent([ev(1, '2026-10-01T01:00:00Z'), ev(2, '2026-09-30T15:00:00Z', true)], NOW)?.id).toBe(2)
    expect(eventTimeLabel(ev(2, '2026-09-30T15:00:00Z', true))).toBe('종일')
    expect(pickNextEvent([ev(1, '2026-10-01T01:00:00Z')], NOW)).toBeNull()
  })
})

describe('우선순위', () => {
  const item = (importanceScore: number, urgencyScore: number, title = 't'): PriorityItem => ({
    sourceType: 'ISSUE_DUE',
    sourceId: title,
    title,
    deepLink: `/x/${title}`,
    importanceScore,
    urgencyScore,
    reason: '',
  })
  it('사분면 라벨은 PriorityQuadrantBody 와 같은 임계값 50', () => {
    expect(quadrantLabel(item(50, 50))).toBe('긴급·중요')
    expect(quadrantLabel(item(80, 10))).toBe('중요')
    expect(quadrantLabel(item(10, 80))).toBe('긴급')
    expect(quadrantLabel(item(10, 10))).toBe('낮음')
  })
  it('최상위는 중요도+긴급도 합 최대, 동점은 앞선 항목', () => {
    expect(topPriorityItem([item(30, 30, 'a'), item(60, 40, 'b'), item(40, 60, 'c')])?.title).toBe('b')
    expect(topPriorityItem([])).toBeNull()
  })
})

describe('메일', () => {
  const m = (id: number, over: Partial<MailSummaryItem> = {}): MailSummaryItem => ({
    id,
    accountId: 1,
    subject: `제목${id}`,
    fromAddress: 'a@x.com',
    fromName: null,
    snippet: null,
    receivedAt: null,
    seen: false,
    hasAttachment: false,
    aiCategory: null,
    aiNeedsReply: null,
    ...over,
  })
  it('배지는 분류 활성이면 회신 필요, 아니면 안 읽음', () => {
    const s: MailSummary = { unreadCount: 12, needsReplyCount: 5, classificationActive: true, recent: [] }
    expect(mailBadgeCount(s)).toBe(5)
    expect(mailBadgeCount({ ...s, classificationActive: false })).toBe(12)
  })
  it('회신 필요(AI true·안 읽음) 메일 우선, 없으면 첫 메일', () => {
    expect(pickLatestMail([m(1), m(2, { aiNeedsReply: true })])?.id).toBe(2)
    expect(pickLatestMail([m(1), m(2, { aiNeedsReply: true, seen: true })])?.id).toBe(1)
    expect(pickLatestMail([])).toBeNull()
  })
  it('발신자: 이름 → 주소 → 알 수 없음', () => {
    expect(mailSender({ fromName: ' 김지훈 ', fromAddress: 'k@x.com' })).toBe('김지훈')
    expect(mailSender({ fromName: null, fromAddress: 'k@x.com' })).toBe('k@x.com')
    expect(mailSender({ fromName: '', fromAddress: null })).toBe('(알 수 없음)')
  })
})

describe('알림·채널·이름', () => {
  it('가장 최근의 안 읽은 알림', () => {
    const n = (id: number, read: boolean, createdAt: string) => ({ id, read, createdAt }) as NotificationResponse
    const items = [n(1, false, '2026-10-01T01:00:00Z'), n(2, true, '2026-10-01T05:00:00Z'), n(3, false, '2026-10-01T03:00:00Z')]
    expect(latestUnreadNotification(items)?.id).toBe(3)
    expect(latestUnreadNotification([n(1, true, '2026-10-01T01:00:00Z')])).toBeNull()
  })
  it('채널: 안 읽음 합계, 가장 많이 안 읽은 채널(모두 0이면 첫 채널)', () => {
    const c = (id: number, unreadCount: number) => ({ id, name: `c${id}`, unreadCount }) as ChannelResponse
    expect(totalUnread([c(1, 2), c(2, 10)])).toBe(12)
    expect(pickBusiestChannel([c(1, 2), c(2, 10)])?.id).toBe(2)
    expect(pickBusiestChannel([c(1, 0), c(2, 0)])?.id).toBe(1)
    expect(pickBusiestChannel([])).toBeNull()
  })
  it('이름은 빈 값을 빼고 앞 5개만 · 로 잇는다', () => {
    expect(joinNames(['a', ' ', 'b', 'c', 'd', 'e', 'f'])).toBe('a · b · c · d · e')
  })
})
