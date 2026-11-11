// 「내 작업 · 개요」 화면 판정(WP-1484) — 기간 파싱, 표기, 마감 배지, 날짜 묶음, 칸 범위, 「모두 보기」 주소.
import { describe, expect, it } from 'vitest'

import type { ClosedItem, MetricsBucket } from '@/types/meOverview'

import {
  bucketLabel,
  closedListHref,
  dailyAverage,
  daysBetween,
  dueBadge,
  formatDays,
  formatRate,
  groupClosedByDate,
  groupsInRange,
  parsePeriod,
  upcomingDueLabel,
} from './overviewModel'

function closed(over: Partial<ClosedItem>): ClosedItem {
  return {
    issueId: 1,
    projectKey: 'WP',
    number: 1,
    title: 't',
    closedAt: '2026-11-10T01:00:00Z',
    closedDate: '2026-11-10',
    dueAtClose: null,
    outcome: 'NO_DUE',
    lateDays: null,
    leadTimeDays: 1,
    withAi: false,
    aiNames: [],
    request: null,
    lastComment: null,
    ...over,
  }
}

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

  it('마감 배지 — 기한 내 / n일 늦음 / 마감 없음', () => {
    expect(dueBadge({ outcome: 'ON_TIME', lateDays: null })).toEqual({ label: '기한 내', tone: 'success' })
    expect(dueBadge({ outcome: 'OVERDUE', lateDays: 2 })).toEqual({ label: '2일 늦음', tone: 'warning' })
    expect(dueBadge({ outcome: 'NO_DUE', lateDays: null })).toEqual({ label: '마감 없음', tone: 'muted' })
  })

  it('앞으로 할 일 마감 표기', () => {
    expect(upcomingDueLabel({ dueDate: '2026-11-05' }, '2026-11-11')).toEqual({ label: '6일 지남', overdue: true })
    expect(upcomingDueLabel({ dueDate: '2026-11-11' }, '2026-11-11')).toEqual({ label: '오늘 마감', overdue: false })
    expect(upcomingDueLabel({ dueDate: '2026-11-14' }, '2026-11-11')).toEqual({ label: '3일 남음', overdue: false })
    expect(upcomingDueLabel({ dueDate: null }, '2026-11-11')).toEqual({ label: '마감 없음', overdue: false })
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1)
  })

  it('끝낸 일은 날짜별로 묶고 날짜 줄 합계는 일별 칸에서', () => {
    const items = [
      closed({ issueId: 1, closedDate: '2026-11-10' }),
      closed({ issueId: 2, closedDate: '2026-11-10' }),
      closed({ issueId: 3, closedDate: '2026-11-09' }),
    ]
    const groups = groupClosedByDate(items, [bucket('2026-11-09', 1, 0), bucket('2026-11-10', 2, 3)])
    expect(groups.map((g) => [g.date, g.completed, g.created, g.items.map((i) => i.issueId)])).toEqual([
      ['2026-11-10', 2, 3, [1, 2]],
      ['2026-11-09', 1, 0, [3]],
    ])
    // 칸으로 고르면 그 칸 범위만.
    expect(groupsInRange(groups, { start: '2026-11-09', end: '2026-11-09' }).map((g) => g.date)).toEqual(['2026-11-09'])
    expect(groupsInRange(groups, { start: '2026-11-03', end: '2026-11-10' })).toHaveLength(2)
    expect(groupsInRange(groups, null)).toHaveLength(2)
  })

  it('칸 라벨 — 일별·주별·월별', () => {
    const now = new Date('2026-11-11T03:00:00Z')
    expect(bucketLabel(bucket('2026-11-10', 0, 0), 'DAY', now)).toBe('11월 10일 (화)')
    expect(bucketLabel(bucket('2026-11-02', 0, 0, '2026-11-08'), 'WEEK', now)).toBe('11월 2일 ~ 11월 8일')
    expect(bucketLabel(bucket('2026-10-01', 0, 0, '2026-10-31'), 'MONTH', now)).toBe('10월')
  })

  it('「모두 보기」는 할당 탭 완료 목록에 완료일 기간을 건다', () => {
    const href = closedListHref('2026-11-01', '2026-11-11')
    const url = new URL(href, 'http://x')
    expect(url.pathname).toBe('/me/tasks/assigned')
    expect(url.searchParams.get('status')).toBe('DONE')
    expect(url.searchParams.get('closedIn')).toBe('2026-11-01~2026-11-11')
  })
})
