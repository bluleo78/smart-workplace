// WP-1746 formatMailQuoteDate — 메일 답장·전달 원문 머리의 「보낸 날짜」(「2026년 11월 18일 수요일 오전 10:42」).
// vitest 는 TZ=Asia/Seoul 로 고정(vitest.config.ts)이라 로컬 타임존 결과가 결정적이다.
import { describe, expect, it } from 'vitest'

import { formatMailQuoteDate } from './formatters'

describe('formatMailQuoteDate', () => {
  it('연·월·일·요일 전체와 오전/오후 시:분 — 2026-11-18 은 수요일', () => {
    // 01:42 UTC = KST 10:42
    expect(formatMailQuoteDate('2026-11-18T01:42:00Z')).toBe('2026년 11월 18일 수요일 오전 10:42')
  })
  it('오후·정오 — 12시는 오후 12시, 분은 두 자리', () => {
    expect(formatMailQuoteDate('2026-11-18T03:05:00Z')).toBe('2026년 11월 18일 수요일 오후 12:05')
    expect(formatMailQuoteDate('2026-11-18T08:00:00Z')).toBe('2026년 11월 18일 수요일 오후 5:00')
  })
  it('자정을 넘긴 시각은 로컬(KST) 날짜 — 15:30 UTC 는 다음 날 오전 12:30', () => {
    expect(formatMailQuoteDate('2026-11-17T15:30:00Z')).toBe('2026년 11월 18일 수요일 오전 12:30')
  })
  it('null/undefined/무효 입력 → 빈 문자열', () => {
    expect(formatMailQuoteDate(null)).toBe('')
    expect(formatMailQuoteDate(undefined)).toBe('')
    expect(formatMailQuoteDate('not-a-date')).toBe('')
  })
})
