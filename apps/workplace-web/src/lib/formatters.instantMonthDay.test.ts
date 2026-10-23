// WP-873 formatInstantMonthDay·formatMonthDayWeekdayClock — 완료일 표기(「10월 23일」·「10월 23일 (금) 오후 2:05」).
// vitest 는 TZ=Asia/Seoul 로 고정(vitest.config.ts)이라 로컬 타임존 결과가 결정적이다.
import { describe, expect, it } from 'vitest'

import { formatInstantMonthDay, formatMonthDayWeekdayClock } from './formatters'

const NOW = new Date('2026-10-23T09:00:00+09:00')

describe('formatInstantMonthDay', () => {
  it('올해 시각 값은 로컬 날짜의 월·일만', () => {
    // 05:05 UTC = KST 14:05
    expect(formatInstantMonthDay('2026-10-23T05:05:00Z', NOW)).toBe('10월 23일')
  })
  it('자정을 넘긴 시각은 로컬(KST) 날짜 — 15:30 UTC 는 다음 날', () => {
    expect(formatInstantMonthDay('2026-10-22T15:30:00Z', NOW)).toBe('10월 23일')
  })
  it('올해가 아니면 연도를 앞에 붙인다', () => {
    expect(formatInstantMonthDay('2025-10-23T05:05:00Z', NOW)).toBe('2025년 10월 23일')
  })
  it('null/undefined/무효 입력 → 빈 문자열', () => {
    expect(formatInstantMonthDay(null, NOW)).toBe('')
    expect(formatInstantMonthDay(undefined, NOW)).toBe('')
    expect(formatInstantMonthDay('not-a-date', NOW)).toBe('')
  })
})

describe('formatMonthDayWeekdayClock', () => {
  it('올해: 월·일 (요일) 오전/오후 시:분 — 2026-10-23 은 금요일', () => {
    expect(formatMonthDayWeekdayClock('2026-10-23T05:05:00Z', NOW)).toBe('10월 23일 (금) 오후 2:05')
  })
  it('오전·자정 경계', () => {
    // 15:30 UTC = KST 다음 날 00:30 → 오전 12:30, 10/23 금요일
    expect(formatMonthDayWeekdayClock('2026-10-22T15:30:00Z', NOW)).toBe('10월 23일 (금) 오전 12:30')
  })
  it('올해가 아니면 연도를 앞에 붙인다 — 2025-10-23 은 목요일', () => {
    expect(formatMonthDayWeekdayClock('2025-10-23T05:05:00Z', NOW)).toBe('2025년 10월 23일 (목) 오후 2:05')
  })
  it('null/undefined/무효 입력 → 빈 문자열', () => {
    expect(formatMonthDayWeekdayClock(null, NOW)).toBe('')
    expect(formatMonthDayWeekdayClock(undefined, NOW)).toBe('')
    expect(formatMonthDayWeekdayClock('not-a-date', NOW)).toBe('')
  })
})
