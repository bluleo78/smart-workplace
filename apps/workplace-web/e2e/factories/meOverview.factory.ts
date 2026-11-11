// 「내 작업 · 개요」(WP-1484) 응답 팩토리 — vitest 화면 테스트(src/pages/me/myOverview.test.tsx)와 E2E(e2e/pages/me/my-tasks.spec.ts)가 같이 쓴다.
import type { LateItem, MeDaySummary, MeOverviewResponse, MetricsBucket, UpcomingItem } from '../../src/types/meOverview'

export const overviewDays = (from: number, to: number, f: (d: string) => Partial<MetricsBucket> = () => ({})): MetricsBucket[] =>
  Array.from({ length: to - from + 1 }, (_, i) => {
    const d = `2026-11-${String(from + i).padStart(2, '0')}`
    return { start: d, end: d, completed: 0, overdue: 0, created: 0, ...f(d) }
  })

/** 마감 준수 카드의 늦게 완료한 이슈 한 줄. */
export const createLateItem = (issueId: number, title: string, lateDays: number): LateItem => ({ issueId, projectKey: 'WP', number: issueId, title, lateDays })

export const createUpcomingItem = (issueId: number, title: string, dueDate: string | null, aiNames: string[] = []): UpcomingItem => ({
  issueId,
  projectKey: 'WP',
  number: issueId,
  title,
  dueDate,
  aiNames,
})

/** 이번 달(11-01~11-11) 개요 — 11-10 에 둘(하나는 AI와 함께·늦음), 11-09 에 하나 완료. 직전 같은 기간은 10-21~10-31. */
export function createMeOverview(over: Partial<MeOverviewResponse> = {}): MeOverviewResponse {
  const counts: Record<string, Partial<MetricsBucket>> = {
    '2026-11-09': { completed: 1, created: 1 },
    '2026-11-10': { completed: 2, overdue: 1, created: 2 },
  }
  const buckets = overviewDays(1, 11, (d) => counts[d] ?? {})
  return {
    period: 'MONTH',
    granularity: 'DAY',
    from: '2026-11-01',
    to: '2026-11-11',
    previousFrom: '2026-10-21',
    previousTo: '2026-10-31',
    day: {
      yesterday: '2026-11-10',
      yesterdayCompleted: 2,
      yesterdayCompletedWithAi: 1,
      yesterdayCompletedOnTime: 1,
      yesterdayCreated: 2,
      today: '2026-11-11',
      overdue: 3,
      oldestOverdueDays: 6,
      dueToday: 2,
      waiting: 4,
    },
    current: {
      completed: 3,
      completedWithAi: 1,
      created: 3,
      onTime: 1,
      overdue: 1,
      noDue: 1,
      overdueLateDaysAvg: 2,
      onTimeRate: 0.5,
      leadTimeDaysAvg: 2.84,
      leadTimeDaysMedian: 2,
    },
    previous: {
      completed: 5,
      completedWithAi: 2,
      created: 4,
      onTime: 3,
      overdue: 1,
      noDue: 1,
      overdueLateDaysAvg: 1,
      onTimeRate: 0.75,
      leadTimeDaysAvg: 3.6,
      leadTimeDaysMedian: 3,
    },
    buckets,
    upcoming: {
      openAssigned: 18,
      overdue: 3,
      dueSoon: 4,
      waiting: 4,
      other: 7,
      overdueTop: [createUpcomingItem(1294, 'genia 실행기 첫 응답 지연', '2026-11-05', ['AI 개발자1'])],
      dueSoonTop: [createUpcomingItem(1300, '마감 임박 일', '2026-11-13')],
      waitingTop: [createUpcomingItem(1310, '답을 기다리는 일', null)],
      otherTop: [],
    },
    lateTop: [createLateItem(1465, '노트 표 붙여넣기', 2)],
    ...over,
  }
}

/** 처음 쓰는 사람 — 숫자 0·빈 목록. */
export function createEmptyMeOverview(): MeOverviewResponse {
  const zero = { completed: 0, completedWithAi: 0, created: 0, onTime: 0, overdue: 0, noDue: 0, overdueLateDaysAvg: null, onTimeRate: null, leadTimeDaysAvg: null, leadTimeDaysMedian: null }
  const o = createMeOverview()
  return {
    ...o,
    day: { ...o.day, yesterdayCompleted: 0, yesterdayCompletedWithAi: 0, yesterdayCompletedOnTime: 0, yesterdayCreated: 0, overdue: 0, oldestOverdueDays: null, dueToday: 0, waiting: 0 },
    current: zero,
    previous: zero,
    buckets: overviewDays(1, 11),
    upcoming: { openAssigned: 0, overdue: 0, dueSoon: 0, waiting: 0, other: 0, overdueTop: [], dueSoonTop: [], waitingTop: [], otherTop: [] },
    lateTop: [],
  }
}

/** 어제/오늘 요약(/me/overview/today) — 기본은 모두 0(홈 「내 작업」 위젯 한 줄). */
export function createMeDaySummary(over: Partial<MeDaySummary> = {}): MeDaySummary {
  return {
    yesterday: '2026-11-10',
    yesterdayCompleted: 0,
    yesterdayCompletedWithAi: 0,
    yesterdayCompletedOnTime: 0,
    yesterdayCreated: 0,
    today: '2026-11-11',
    overdue: 0,
    oldestOverdueDays: null,
    dueToday: 0,
    waiting: 0,
    ...over,
  }
}
