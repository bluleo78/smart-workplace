// #828 — toLocale* 직접 호출을 대체한 로케일 표기 유지용 포매터 회귀 테스트.
// vitest.config 가 TZ=Asia/Seoul 고정. 오전/오후는 포매터가 직접 붙여 ICU 와 무관하다(WP-1029) — 정확한 문자열로 본다.
import { describe, expect, it } from 'vitest'

import {
  formatClockTimePadded,
  formatDateMonthDayPadded,
  formatDateShort,
  formatDateTimeLocale,
  formatLocalClockTime24,
  formatNumber,
} from './formatters'

const INVALID = [null, undefined, '', 'not-a-date']

describe('formatLocalClockTime24', () => {
  it('24시간 "HH:mm" — 로컬(KST) 기준, 자정은 00:00', () => {
    expect(formatLocalClockTime24('2026-07-15T05:30:00Z')).toBe('14:30')
    expect(formatLocalClockTime24('2026-07-14T15:00:00Z')).toBe('00:00')
    expect(formatLocalClockTime24('2026-07-15T09:05:00+09:00')).toBe('09:05')
  })
  it('무효 입력 → "-"', () => {
    for (const v of INVALID) expect(formatLocalClockTime24(v)).toBe('-')
  })
})

describe('formatClockTimePadded', () => {
  it('12시간제 + 시 zero-pad ("오후 02:30")', () => {
    // 오전/오후는 ICU 와 무관하게 한국어(WP-1029). 로컬 타임존 기준이라 TZ=Asia/Seoul(테스트 설정) 값이다.
    expect(formatClockTimePadded('2026-07-15T05:30:00Z')).toBe('오후 02:30')
    expect(formatClockTimePadded('2026-07-15T00:05:00Z')).toBe('오전 09:05')
    expect(formatClockTimePadded('2026-07-15T03:00:00Z')).toBe('오후 12:00')
  })
  it('무효 입력 → "-"', () => {
    for (const v of INVALID) expect(formatClockTimePadded(v)).toBe('-')
  })
})

describe('formatDateMonthDayPadded', () => {
  it('월·일 2자리 ("07. 05.")', () => {
    expect(formatDateMonthDayPadded('2026-07-05T05:30:00Z')).toBe('07. 05.')
    // UTC 15:00 = KST 다음날
    expect(formatDateMonthDayPadded('2026-12-31T15:00:00Z')).toBe('01. 01.')
  })
  it('무효 입력 → "-"', () => {
    for (const v of INVALID) expect(formatDateMonthDayPadded(v)).toBe('-')
  })
})

describe('formatDateTimeLocale', () => {
  it('ko-KR 전체 일시 ("2026. 7. 5. 오후 2:30:00")', () => {
    expect(formatDateTimeLocale('2026-07-05T05:30:00Z')).toBe('2026. 7. 5. 오후 2:30:00')
    expect(formatDateTimeLocale('2026-07-04T15:00:09Z')).toBe('2026. 7. 5. 오전 12:00:09')
  })
  it('무효 입력 → "-"', () => {
    for (const v of INVALID) expect(formatDateTimeLocale(v)).toBe('-')
  })
})

describe('formatDateShort', () => {
  it('ko-KR 날짜 ("2026. 7. 5.")', () => {
    expect(formatDateShort('2026-07-05T05:30:00Z')).toBe('2026. 7. 5.')
  })
  it('무효 입력 → "-"', () => {
    for (const v of INVALID) expect(formatDateShort(v)).toBe('-')
  })
})

describe('formatNumber', () => {
  it('천단위 구분', () => {
    expect(formatNumber(Number.MAX_SAFE_INTEGER)).toBe('9,007,199,254,740,991')
    expect(formatNumber(-1234)).toBe('-1,234')
    expect(formatNumber(0)).toBe('0')
  })
})
