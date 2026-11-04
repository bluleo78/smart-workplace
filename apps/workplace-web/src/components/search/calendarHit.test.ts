// 캘린더 검색 결과 → 팔레트 한 줄 변환(WP-1357) — 단일·종일·반복·지난·올해 아님·맞은 곳별 둘째 줄.
import { CalendarDays, Repeat } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import type { CalendarEventSearchItem } from '@/types/calendar'

import { GROUP_PAST, GROUP_UPCOMING, toCalendarHit } from './calendarHit'

// 로컬 시각 기준으로 만들어 타임존에 상관없이 같은 표기가 나오게 한다.
const NOW = new Date(2026, 10, 5, 12, 0)
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

function item(over: Partial<CalendarEventSearchItem> = {}): CalendarEventSearchItem {
  return {
    id: 1,
    title: '주간 개발 회의',
    startsAt: local(2026, 11, 6, 10),
    endsAt: local(2026, 11, 6, 11),
    allDay: false,
    location: null,
    calendarName: '내 캘린더',
    calendarColor: 'blue',
    recurrenceRule: null,
    occurrenceStart: local(2026, 11, 6, 10),
    past: false,
    matchedField: 'TITLE',
    matchedText: null,
    ...over,
  }
}

describe('toCalendarHit', () => {
  it('단일 일정 — 요일 있는 시각 meta, 짧은 meta 는 요일 없이, 캘린더 꼬리표, 다가오는 일정 그룹', () => {
    const h = toCalendarHit(item(), NOW)
    expect(h).toMatchObject({
      key: 'calendar:1',
      app: 'calendar',
      title: '주간 개발 회의',
      href: '/calendar?eventId=1',
      meta: '11월 6일 (금) 10:00',
      metaShort: '11월 6일 10:00',
      tag: { name: '내 캘린더', color: 'blue' },
      group: GROUP_UPCOMING,
      dimmed: false,
      icon: CalendarDays,
    })
    expect(h.snippet).toBeUndefined()
  })

  it('종일 일정 — 시각 대신 「종일」(UTC 자정 값이어도 날짜가 하루 밀리지 않는다)', () => {
    const h = toCalendarHit(item({ allDay: true, startsAt: '2026-11-20T00:00:00Z', endsAt: '2026-11-21T00:00:00Z', occurrenceStart: '2026-11-20T00:00:00Z' }), NOW)
    expect(h.meta).toBe('11월 20일 (금) 종일')
    expect(h.metaShort).toBe('11월 20일 종일')
  })

  it('반복 일정 — 「매주 금 · 다음 …」에 아이콘 Repeat, 다음 회차 시각을 보인다', () => {
    const h = toCalendarHit(
      item({
        id: 2,
        startsAt: local(2026, 10, 2, 16),
        endsAt: local(2026, 10, 2, 17),
        recurrenceRule: 'FREQ=WEEKLY',
        occurrenceStart: local(2026, 11, 6, 16),
      }),
      NOW,
    )
    expect(h.meta).toBe('매주 금 · 다음 11월 6일 16:00')
    expect(h.metaShort).toBe('11월 6일 16:00')
    expect(h.icon).toBe(Repeat)
  })

  it('끝난 반복 — 「마지막」 회차, 지난 일정 그룹·흐림', () => {
    const h = toCalendarHit(
      item({ startsAt: local(2026, 1, 2, 9), recurrenceRule: 'FREQ=WEEKLY;COUNT=3', occurrenceStart: local(2026, 1, 16, 9), past: true }),
      NOW,
    )
    expect(h.meta).toBe('매주 금 · 3회 · 마지막 1월 16일 09:00')
    expect(h).toMatchObject({ group: GROUP_PAST, dimmed: true })
  })

  it('올해가 아니면 연도를 붙인다', () => {
    const h = toCalendarHit(item({ startsAt: local(2025, 12, 19, 14), past: true }), NOW)
    expect(h.meta).toBe('2025년 12월 19일 (금) 14:00')
    expect(h.metaShort).toBe('2025년 12월 19일 14:00')
  })

  it('장소·참석자에서 맞으면 둘째 줄 라벨과 값, 제목에서 맞으면 없다', () => {
    expect(toCalendarHit(item({ matchedField: 'LOCATION', matchedText: '판교 회의실' }), NOW)).toMatchObject({
      snippet: '판교 회의실',
      snippetLabel: '장소',
    })
    expect(toCalendarHit(item({ matchedField: 'ATTENDEE', matchedText: '주간희' }), NOW)).toMatchObject({
      snippet: '주간희',
      snippetLabel: '참석자',
    })
    const t = toCalendarHit(item({ matchedField: 'TITLE', matchedText: null }), NOW)
    expect(t.snippet).toBeUndefined()
    expect(t.snippetLabel).toBeUndefined()
  })
})
