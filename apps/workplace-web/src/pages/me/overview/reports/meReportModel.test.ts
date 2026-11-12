// 개인 보고(WP-1486) 순수 모델 — 만들기 창의 기본 기간(어제·지난주·지난달), 최근 주·달 목록과 주차 이름(서버 규칙과 같음),
// 저장 위치 문구, 시각 보기, 설정 창의 「다음 보고」 줄.
import { describe, expect, test } from 'vitest'

import {
  defaultDaily,
  defaultMonth,
  defaultWeekStart,
  hourOptions,
  monthFolderLabel,
  nextRunLabel,
  recentMonths,
  recentWeeks,
} from './meReportModel'

const TODAY = '2026-11-12' // 목요일

describe('기본 기간', () => {
  test('일일은 어제, 주간은 지난주 월요일, 월간은 지난달', () => {
    expect(defaultDaily(TODAY)).toBe('2026-11-11')
    expect(defaultWeekStart(TODAY)).toBe('2026-11-02')
    expect(defaultMonth(TODAY)).toBe('2026-10')
  })

  test('달·해 경계 — 1월 1일의 어제는 지난해 12월 31일, 1월의 지난달은 지난해 12월', () => {
    expect(defaultDaily('2027-01-01')).toBe('2026-12-31')
    expect(defaultMonth('2027-01-15')).toBe('2026-12')
  })

  test('월요일이 오늘이면 지난주 월요일은 7일 전, 일요일이면 13일 전', () => {
    expect(defaultWeekStart('2026-11-09')).toBe('2026-11-02')
    expect(defaultWeekStart('2026-11-15')).toBe('2026-11-02')
  })
})

describe('recentWeeks', () => {
  test('최신(이번 주) 먼저 8개, 주차 이름은 「11월 3주차 (11/9~15)」', () => {
    const weeks = recentWeeks(TODAY)
    expect(weeks).toHaveLength(8)
    expect(weeks[0]).toEqual({ weekStart: '2026-11-09', label: '11월 3주차 (11/9~15)' })
    expect(weeks[1]).toEqual({ weekStart: '2026-11-02', label: '11월 2주차 (11/2~8)' })
  })

  test('주의 달은 일요일의 달 — 10/26 주는 11월 1주차', () => {
    expect(recentWeeks(TODAY).find((w) => w.weekStart === '2026-10-26')?.label).toBe('11월 1주차 (10/26~11/1)')
    // 1일이 일요일이 아닌 달 — 2026-10-01(목)이 든 9/28 주는 10월 1주차.
    expect(recentWeeks(TODAY).find((w) => w.weekStart === '2026-10-19')?.label).toBe('10월 4주차 (10/19~25)')
  })

  test('n 을 주면 그만큼', () => {
    expect(recentWeeks(TODAY, 3).map((w) => w.weekStart)).toEqual(['2026-11-09', '2026-11-02', '2026-10-26'])
  })
})

describe('recentMonths', () => {
  test('이번 달 먼저 12개, 이름은 「11월」, 해를 넘으면 지난해 달', () => {
    const months = recentMonths(TODAY)
    expect(months).toHaveLength(12)
    expect(months[0]).toEqual({ month: '2026-11', label: '11월' })
    expect(months[1]).toEqual({ month: '2026-10', label: '10월' })
    expect(months[11].month).toBe('2025-12')
  })

  test('지난해 달은 연도를 붙여 이름이 겹치지 않게', () => {
    expect(recentMonths(TODAY)[11].label).toBe('2025년 12월')
  })
})

describe('monthFolderLabel', () => {
  test('일일은 그날의 달, 주간은 일요일(기간 끝)의 달, 월간은 그 달', () => {
    expect(monthFolderLabel('DAILY', '2026-11-11')).toBe('내 노트 › 보고 › 2026년 11월')
    expect(monthFolderLabel('WEEKLY', '2026-10-26')).toBe('내 노트 › 보고 › 2026년 11월')
    expect(monthFolderLabel('MONTHLY', '2026-10')).toBe('내 노트 › 보고 › 2026년 10월')
  })

  test('값이 비면 「내 노트 › 보고」까지만', () => {
    expect(monthFolderLabel('DAILY', '')).toBe('내 노트 › 보고')
  })
})

test('hourOptions — 00:00 부터 23:00 까지 정시 24개', () => {
  const hours = hourOptions()
  expect(hours).toHaveLength(24)
  expect(hours[0]).toBe('00:00')
  expect(hours[9]).toBe('09:00')
  expect(hours[23]).toBe('23:00')
})

test('nextRunLabel — 서울 시각으로 「다음 보고 11월 13일 (금) 09:00」', () => {
  expect(nextRunLabel('2026-11-13T00:00:00Z', new Date('2026-11-12T03:00:00Z'))).toBe('다음 보고 11월 13일 (금) 09:00')
})
