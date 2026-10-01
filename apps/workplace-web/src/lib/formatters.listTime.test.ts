import { describe, expect, it } from 'vitest'

import { formatListTime } from './formatters'

// 기준 시각: 2026-10-01 15:00 KST(= 06:00Z). 시간 표기는 Asia/Seoul 기준.
const NOW = new Date('2026-10-01T06:00:00Z')

describe('formatListTime', () => {
  it('오늘이면 오전/오후 시각', () => {
    expect(formatListTime('2026-10-01T04:05:00Z', NOW)).toBe('오후 1:05') // 13:05 KST
    expect(formatListTime('2026-09-30T15:00:00Z', NOW)).toBe('오전 12:00') // 10-01 00:00 KST(자정 직후 = 오늘)
  })
  it('어제면 "어제" — 자정 직전 포함', () => {
    expect(formatListTime('2026-09-30T14:59:00Z', NOW)).toBe('어제') // 09-30 23:59 KST
    expect(formatListTime('2026-09-29T15:00:00Z', NOW)).toBe('어제') // 09-30 00:00 KST
  })
  it('올해 그 이전이면 "M월 D일"', () => {
    expect(formatListTime('2026-09-28T03:00:00Z', NOW)).toBe('9월 28일')
    expect(formatListTime('2026-01-01T00:00:00Z', NOW)).toBe('1월 1일')
  })
  it('작년 이전이면 "YYYY. M. D."', () => {
    expect(formatListTime('2025-12-31T05:00:00Z', NOW)).toBe('2025. 12. 31.')
    expect(formatListTime('2025-12-03T05:00:00Z', NOW)).toBe('2025. 12. 3.')
  })
  it('무효 입력이면 빈 문자열', () => {
    expect(formatListTime('', NOW)).toBe('')
  })
})
