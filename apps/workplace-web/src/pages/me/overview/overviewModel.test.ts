// 「내 작업 · 개요」 화면 판정(WP-1484) — 기간 파싱, 표기, 직전 같은 기간 툴팁, 할당 탭 완료 목록 주소.
import { describe, expect, it } from 'vitest'

import type { MetricsBucket } from '@/types/meOverview'

import {
  bucketLabel,
  closedListHref,
  compareRangeLabel,
  dailyAverage,
  daysBetween,
  formatDays,
  formatRate,
  parsePeriod,
  upcomingDueLabel,
} from './overviewModel'

const bucket = (start: string, completed: number, created: number, end = start): MetricsBucket => ({ start, end, completed, overdue: 0, created })

describe('overviewModel', () => {
  it('기간은 모르는 값이면 이번 달', () => {
    expect(parsePeriod('WEEK')).toBe('WEEK')
    expect(parsePeriod('QUARTER')).toBe('QUARTER')
    expect(parsePeriod(null)).toBe('MONTH')
    expect(parsePeriod('YEAR')).toBe('MONTH')
  })

  it('일수·비율·하루 평균 표기', () => {
    expect(formatDays(2.84)).toBe('2.8일')
    expect(formatDays(3)).toBe('3일')
    expect(formatDays(2.96)).toBe('3일')
    expect(formatDays(null)).toBe('—')
    expect(formatRate(0.857)).toBe('86%')
    expect(formatRate(null)).toBe('—')
    expect(dailyAverage(26, 11)).toBe('2.4')
    expect(dailyAverage(0, 11)).toBe('0')
    expect(dailyAverage(22, 11)).toBe('2')
  })

  it('직전 같은 기간 툴팁 — 같은 달·달 넘김·하루·해 넘김', () => {
    expect(compareRangeLabel('2026-10-21', '2026-10-31')).toBe('10월 21일~31일과 비교')
    expect(compareRangeLabel('2026-10-26', '2026-11-01')).toBe('10월 26일~11월 1일과 비교')
    expect(compareRangeLabel('2026-11-08', '2026-11-08')).toBe('11월 8일과 비교')
    expect(compareRangeLabel('2026-12-07', '2027-01-04')).toBe('2026년 12월 7일~2027년 1월 4일과 비교')
  })

  it('맡은 이슈 마감 표기', () => {
    expect(upcomingDueLabel({ dueDate: '2026-11-05' }, '2026-11-11')).toEqual({ label: '6일 지남', overdue: true })
    expect(upcomingDueLabel({ dueDate: '2026-11-11' }, '2026-11-11')).toEqual({ label: '오늘 마감', overdue: false })
    expect(upcomingDueLabel({ dueDate: '2026-11-14' }, '2026-11-11')).toEqual({ label: '3일 남음', overdue: false })
    expect(upcomingDueLabel({ dueDate: null }, '2026-11-11')).toEqual({ label: '마감 없음', overdue: false })
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1)
  })

  it('칸 라벨 — 일별·주별·월별', () => {
    const now = new Date('2026-11-11T03:00:00Z')
    expect(bucketLabel(bucket('2026-11-10', 0, 0), 'DAY', now)).toBe('11월 10일 (화)')
    expect(bucketLabel(bucket('2026-11-02', 0, 0, '2026-11-08'), 'WEEK', now)).toBe('11월 2일 ~ 11월 8일')
    expect(bucketLabel(bucket('2026-10-01', 0, 0, '2026-10-31'), 'MONTH', now)).toBe('10월')
  })

  it('완료 목록 주소는 할당 탭에 완료(취소 제외)와 완료일 기간을 건다', () => {
    const href = closedListHref('2026-11-01', '2026-11-11')
    const url = new URL(href, 'http://x')
    expect(url.pathname).toBe('/me/tasks/assigned')
    expect(url.searchParams.get('status')).toBe('DONE')
    expect(url.searchParams.get('closedIn')).toBe('2026-11-01~2026-11-11')
  })
})
