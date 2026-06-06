import { describe, expect, it } from 'vitest'

import { formatClockTime } from './formatters'

describe('formatClockTime', () => {
  it('null/undefined → "-"', () => {
    expect(formatClockTime(null)).toBe('-')
    expect(formatClockTime(undefined)).toBe('-')
  })
  it('시:분 형태(ko-KR 오전/오후)로 포맷', () => {
    // 2026-06-06T06:24:00Z = KST 15:24
    // ICU full: "오후 3:24", ICU small: "PM 3:24" — 환경 의존이므로 패턴만 검사
    const result = formatClockTime('2026-06-06T06:24:00Z')
    expect(result).toMatch(/3:24/)
  })
  it('타임존 미표기 문자열은 UTC 로 간주', () => {
    // 00:05 UTC = KST 09:05
    // ICU full: "오전 9:05", ICU small: "AM 9:05" — 환경 의존이므로 패턴만 검사
    const result = formatClockTime('2026-06-06T00:05:00')
    expect(result).toMatch(/9:05/)
  })
})
