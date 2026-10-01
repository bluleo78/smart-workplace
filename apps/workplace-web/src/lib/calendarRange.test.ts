// resolveCalendarRange — CalendarWidget 에서 옮긴 범위 계산이 기존 규칙(오늘·이번 주·date-only)과 같은지 고정한다(WP-142).
// vitest 는 TZ=Asia/Seoul 고정(vitest.config.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveCalendarRange } from './calendarRange'

describe('resolveCalendarRange', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T03:00:00Z')) // KST 10/01 12:00
  })
  afterEach(() => vi.useRealTimers())

  it('params 가 없으면 오늘 00:00 ~ 내일 00:00(로컬)', () => {
    expect(resolveCalendarRange()).toEqual({
      from: '2026-09-30T15:00:00.000Z',
      to: '2026-10-01T15:00:00.000Z',
    })
  })

  it('range=week 면 오늘부터 7일(종료 exclusive)', () => {
    expect(resolveCalendarRange({ range: 'week' }).to).toBe('2026-10-07T15:00:00.000Z')
  })

  it('date-only from/to 는 종료일을 포함하도록 +1일, 역전 범위는 from 기준 하루', () => {
    expect(resolveCalendarRange({ from: '2026-10-03', to: '2026-10-04' })).toEqual({
      from: '2026-10-02T15:00:00.000Z',
      to: '2026-10-04T15:00:00.000Z',
    })
    expect(resolveCalendarRange({ from: '2026-10-05', to: '2026-10-01' }).to).toBe('2026-10-05T15:00:00.000Z')
  })
})
