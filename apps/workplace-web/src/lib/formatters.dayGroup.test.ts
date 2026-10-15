import { describe, expect, it } from 'vitest'

import { formatDayGroupLabel } from './formatters'

// 기준 시각: 2026-10-15(목) 10:00 KST(= 01:00Z). 묶음은 Asia/Seoul 날짜 기준.
const NOW = new Date('2026-10-15T01:00:00Z')

describe('formatDayGroupLabel', () => {
  it('오늘·어제 — 자정 경계는 KST', () => {
    expect(formatDayGroupLabel('2026-10-14T15:00:00Z', NOW)).toBe('오늘') // 10-15 00:00 KST
    expect(formatDayGroupLabel('2026-10-14T14:59:00Z', NOW)).toBe('어제') // 10-14 23:59 KST
    expect(formatDayGroupLabel('2026-10-13T15:00:00Z', NOW)).toBe('어제') // 10-14 00:00 KST
  })
  it('올해 그 이전이면 "M월 D일 요일"', () => {
    expect(formatDayGroupLabel('2026-10-09T07:25:00Z', NOW)).toBe('10월 9일 금요일')
    expect(formatDayGroupLabel('2026-01-01T00:00:00Z', NOW)).toBe('1월 1일 목요일')
  })
  it('다른 해면 연도를 붙인다', () => {
    expect(formatDayGroupLabel('2025-10-09T03:00:00Z', NOW)).toBe('2025년 10월 9일 목요일')
  })
  it('무효 입력이면 빈 문자열', () => {
    expect(formatDayGroupLabel('', NOW)).toBe('')
  })
})
