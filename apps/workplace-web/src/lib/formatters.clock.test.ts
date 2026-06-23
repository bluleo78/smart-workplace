import { describe, expect, it } from 'vitest'

import { formatClockTime, formatClockTimeCompact } from './formatters'

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

describe('formatClockTimeCompact', () => {
  it('null/undefined → "-"', () => {
    expect(formatClockTimeCompact(null)).toBe('-')
    expect(formatClockTimeCompact(undefined)).toBe('-')
  })
  it('24시간 "HH:mm" — 오전/오후 접두어 없음', () => {
    // 13:00 UTC = KST 22:00 → "22:00", 오전/오후 문자 없음
    const pm = formatClockTimeCompact('2026-06-06T13:00:00Z')
    expect(pm).toBe('22:00')
    expect(pm).not.toMatch(/오전|오후/)
  })
  it('자정 이전 한 자리 시간도 2자리로 zero-pad', () => {
    // 00:05 UTC = KST 09:05 → "09:05"
    expect(formatClockTimeCompact('2026-06-06T00:05:00')).toBe('09:05')
  })
})
