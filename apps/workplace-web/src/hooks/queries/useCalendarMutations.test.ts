// applyFreshVersion(WP-1920) — 수정 응답의 새 updatedAt 을 캐시된 일정에 반영하는 규칙을 실제 QueryClient 로 확인한다.
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import type { CalendarEvent } from '../../types/calendar'
import { calendarKeys } from './calendarKeys'
import { applyFreshVersion } from './useCalendarMutations'

// 필요한 필드만 채운 일정 — 나머지는 이 함수가 보지 않는다.
function ev(id: number, updatedAt: string, extra: Record<string, unknown> = {}): CalendarEvent {
  return { id, title: `e${id}`, updatedAt, ...extra } as unknown as CalendarEvent
}

describe('applyFreshVersion', () => {
  it('scope 없음·ALL 응답은 같은 id 의 마스터와 가상 회차 항목을 모두 새 버전으로 고친다', () => {
    const qc = new QueryClient()
    const key = calendarKeys.range('2026-11-19', '2026-11-23')
    qc.setQueryData(key, [
      ev(1, 'v0'),
      ev(1, 'v0', { occurrenceDate: '2026-11-21T01:00:00Z' }),
      ev(1, 'v0', { occurrenceDate: '2026-11-22T01:00:00Z' }),
      ev(2, 'v0'),
    ])
    qc.setQueryData([...calendarKeys.eventDetails, 1], ev(1, 'v0'))

    applyFreshVersion(qc, ev(1, 'v1'))

    const list = qc.getQueryData<CalendarEvent[]>(key)!
    expect(list.map((e) => e.updatedAt)).toEqual(['v1', 'v1', 'v1', 'v0'])
    // 같은 id 의 다른 필드는 그대로 둔다.
    expect((list[1] as unknown as { occurrenceDate: string }).occurrenceDate).toBe('2026-11-21T01:00:00Z')
    expect(qc.getQueryData<CalendarEvent>([...calendarKeys.eventDetails, 1])!.updatedAt).toBe('v1')
  })

  it('다른 id 의 응답(고친 회차 override)은 다른 항목을 건드리지 않는다', () => {
    const qc = new QueryClient()
    const key = calendarKeys.range('2026-11-19', '2026-11-23')
    const data = [ev(1, 'v0'), ev(1, 'v0', { occurrenceDate: 'x' }), ev(2, 'v0')]
    qc.setQueryData(key, data)

    applyFreshVersion(qc, ev(99, 'v9'))

    expect(qc.getQueryData(key)).toBe(data)
  })

  it('바뀐 게 없으면 같은 객체 참조를 돌려준다', () => {
    const qc = new QueryClient()
    const key = calendarKeys.range('2026-11-19', '2026-11-23')
    const data = [ev(1, 'v1'), ev(2, 'v0')]
    qc.setQueryData(key, data)

    applyFreshVersion(qc, ev(1, 'v1'))

    expect(qc.getQueryData(key)).toBe(data)
  })
})
