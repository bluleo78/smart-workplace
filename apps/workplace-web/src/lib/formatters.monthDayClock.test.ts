// WP-301 formatMonthDayClock — 노트 AI 요약 카드의 "요약 시각" 표기("10/8 14:20").
// vitest 는 TZ=Asia/Seoul 로 고정(vitest.config.ts)이라 로컬 타임존 결과가 결정적이다.
import { describe, expect, it } from 'vitest'

import { formatMonthDayClock } from './formatters'

describe('formatMonthDayClock', () => {
  it('null/undefined/무효 입력 → "-"', () => {
    expect(formatMonthDayClock(null)).toBe('-')
    expect(formatMonthDayClock(undefined)).toBe('-')
    expect(formatMonthDayClock('not-a-date')).toBe('-')
  })
  it('월/일은 pad 없이, 시:분은 2자리 24시간제', () => {
    // 05:20 UTC = KST 14:20
    expect(formatMonthDayClock('2026-10-08T05:20:00Z')).toBe('10/8 14:20')
  })
  it('타임존 미표기 문자열은 UTC 로 간주하고 한 자리 시각은 zero-pad', () => {
    // 00:05 UTC = KST 09:05
    expect(formatMonthDayClock('2026-03-01T00:05:00')).toBe('3/1 09:05')
  })
})
