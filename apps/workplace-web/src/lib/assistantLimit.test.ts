// 비서 사용 한도 대기 표시(WP-2108) — 브라우저 로컬 시각 기준 문구. now 를 고정해 같은 날·다른 날을 가른다.
import { describe, expect, it } from 'vitest'

import { limitWaitBadgeText } from './assistantLimit'
import { formatTodayOrMonthDayClock } from './formatters'

const NOW = new Date(2026, 10, 25, 10, 0)
const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).toISOString()

describe('formatTodayOrMonthDayClock', () => {
  it('같은 날은 HH:mm', () => {
    expect(formatTodayOrMonthDayClock(at(25, 15, 30), NOW)).toBe('15:30')
  })

  it('다른 날은 M월 d일 HH:mm', () => {
    expect(formatTodayOrMonthDayClock(at(26, 15, 30), NOW)).toBe('11월 26일 15:30')
  })
})

describe('limitWaitBadgeText', () => {
  it('미래 시각이면 「한도 대기 · … 이후」', () => {
    expect(limitWaitBadgeText(at(25, 15, 30), NOW)).toBe('한도 대기 · 15:30 이후')
  })

  it('지난 시각·없음은 null', () => {
    expect(limitWaitBadgeText(at(25, 9, 0), NOW)).toBeNull()
    expect(limitWaitBadgeText(null, NOW)).toBeNull()
    expect(limitWaitBadgeText(undefined, NOW)).toBeNull()
  })

  it('읽을 수 없는 시각 문자열은 null(「NaN:NaN」을 그리지 않는다)', () => {
    expect(limitWaitBadgeText('not-a-date', NOW)).toBeNull()
  })
})

describe('formatTodayOrMonthDayClock — 공통 포매터 경로', () => {
  it('타임존 표기 없는 시각은 UTC 로 보고, 무효 입력은 「-」', () => {
    expect(formatTodayOrMonthDayClock('not-a-date', NOW)).toBe('-')
    const local = new Date('2026-11-25T06:30:00Z')
    const expected = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`
    expect(formatTodayOrMonthDayClock('2026-11-25T06:30:00', local)).toBe(expected)
  })
})
