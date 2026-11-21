import { describe, expect, it } from 'vitest'

import { formatLocalMonthDaySlash } from './formatters'

// 로컬 타임존(vitest TZ=Asia/Seoul) 기준 — WP-1910
describe('formatLocalMonthDaySlash', () => {
  it('같은 해면 M/d', () => {
    expect(formatLocalMonthDaySlash('2026-12-02T09:00:00+09:00', new Date(2026, 11, 3))).toBe('12/2')
  })
  it('해가 다르면 yyyy/M/d', () => {
    expect(formatLocalMonthDaySlash('2026-12-30T10:00:00+09:00', new Date(2027, 0, 1))).toBe('2026/12/30')
  })
  it('무효 입력은 빈 문자열', () => {
    expect(formatLocalMonthDaySlash(null, new Date())).toBe('')
    expect(formatLocalMonthDaySlash(undefined, new Date())).toBe('')
    expect(formatLocalMonthDaySlash('abc', new Date())).toBe('')
  })
})
