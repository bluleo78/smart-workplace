import { describe, expect, it } from 'vitest'

import { formatCellValue, formatClockTime, formatClockTimeCompact } from './formatters'

describe('formatClockTime', () => {
  it('null/undefined → "-"', () => {
    expect(formatClockTime(null)).toBe('-')
    expect(formatClockTime(undefined)).toBe('-')
  })
  it('시:분 형태(KST 오전/오후)로 포맷', () => {
    // 2026-06-06T06:24:00Z = KST 15:24
    expect(formatClockTime('2026-06-06T06:24:00Z')).toBe('오후 3:24')
  })
  it('타임존 미표기 문자열은 UTC 로 간주', () => {
    // 00:05 UTC = KST 09:05
    expect(formatClockTime('2026-06-06T00:05:00')).toBe('오전 9:05')
  })
  it('오전/오후는 ICU 로케일 데이터와 무관하게 한국어 — 자정은 오전 12시, 정오는 오후 12시(WP-1029)', () => {
    // Node 24(ICU 78)는 ko-KR 에도 「AM/PM」을 내므로 Intl 에 맡기면 여기서 깨진다.
    expect(formatClockTime('2026-06-05T15:00:00Z')).toBe('오전 12:00')
    expect(formatClockTime('2026-06-06T03:00:00Z')).toBe('오후 12:00')
    expect(formatClockTime('2026-06-06T14:59:00Z')).toBe('오후 11:59')
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

describe('formatCellValue', () => {
  it('TIMESTAMP 는 로컬 「2026. 7. 5. 오후 2:30」 — 오전/오후는 ICU 와 무관(WP-1029)', () => {
    expect(formatCellValue('2026-07-05T05:30:00Z', 'TIMESTAMP')).toBe('2026. 7. 5. 오후 2:30')
    expect(formatCellValue('2026-07-04T15:05:00Z')).toBe('2026. 7. 5. 오전 12:05')
  })
})
