// eventTime·todayAgenda(WP-412) — 홈 '오늘 일정' 위젯 표시 규칙 단위 테스트(홈 E2E 에서 이관).
// TZ=Asia/Seoul 고정 — 시각 라벨은 로컬(KST) 24시간제다.
import { describe, expect, it } from 'vitest'

import type { CalendarEvent } from '@/types/calendar'

import { eventTime, todayAgenda } from './bodyRules'

function ev(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 1,
    title: 'e',
    description: null,
    startsAt: '2026-06-18T05:00:00Z',
    endsAt: '2026-06-18T06:00:00Z',
    allDay: false,
    location: null,
    color: null,
    reminderMinutes: null,
    recurrenceRule: null,
    calendarId: 1,
    calendarName: '내 캘린더',
    effectiveColor: '#3b82f6',
    createdAt: '2026-06-18T00:00:00Z',
    updatedAt: '2026-06-18T00:00:00Z',
    ...over,
  } as CalendarEvent
}

// 서버가 startsAt 을 null 로 내려보내는 엣지 케이스(#339) — 타입은 string 이지만 런타임 방어가 필요하다.
const NULL_START = null as unknown as string

describe('eventTime', () => {
  it('종일은 "종일", 시각은 로컬 24시간제 "HH:mm"', () => {
    expect(eventTime(ev({ allDay: true }))).toEqual({ label: '종일', kind: 'allday' })
    expect(eventTime(ev({ startsAt: '2026-06-18T05:00:00Z' }))).toEqual({ label: '14:00', kind: 'timed' })
  })

  it('시작시각이 null·빈 값이면 Invalid Date 대신 "미정"', () => {
    expect(eventTime(ev({ startsAt: NULL_START }))).toEqual({ label: '미정', kind: 'untimed' })
    expect(eventTime(ev({ startsAt: '' }))).toEqual({ label: '미정', kind: 'untimed' })
  })
})

describe('todayAgenda', () => {
  const mixed = [
    ev({ id: 1, title: '미정 일정', startsAt: NULL_START }),
    ev({ id: 2, title: '종일 일정', allDay: true, startsAt: '2026-06-18T00:00:00Z' }),
    ev({ id: 3, title: '오후 회의', startsAt: '2026-06-18T05:00:00Z' }),
  ]

  it('시작 시각순으로 정렬하고 미정은 맨 뒤에 둔다', () => {
    expect(todayAgenda(mixed, 5).top.map((e) => e.title)).toEqual(['종일 일정', '오후 회의', '미정 일정'])
  })

  it('미정 건수는 count 로 자르기 전 전체 기준이다', () => {
    const r = todayAgenda(mixed, 2)
    expect(r.top.map((e) => e.title)).toEqual(['종일 일정', '오후 회의'])
    expect(r.untimedCount).toBe(1)
  })
})
