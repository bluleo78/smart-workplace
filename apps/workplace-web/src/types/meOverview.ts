// 「내 작업 · 개요」 탭(WP-1484) — 백엔드 MeOverviewResponse·MeDaySummary 와 1:1. 날짜는 서울 날짜 키(YYYY-MM-DD).

/** 기간 고르기 — 이번 주 / 이번 달(기본) / 최근 3개월(오늘 포함 90일). */
export type MeOverviewPeriod = 'WEEK' | 'MONTH' | 'QUARTER'

/** 추이 칸 단위 — 일별(기본) / 주별 / 월별. */
export type MetricsGranularity = 'DAY' | 'WEEK' | 'MONTH'

/** 어제 한 일 / 오늘 할 일 — 기간과 무관. 홈 위젯 한 줄도 같은 값(/me/overview/today). */
export interface MeDaySummary {
  yesterday: string
  yesterdayCompleted: number
  yesterdayCompletedWithAi: number
  yesterdayCompletedOnTime: number
  yesterdayCreated: number
  today: string
  overdue: number
  /** 마감 지난 것 중 가장 오래된 것의 지난 날수 — 없으면 null. */
  oldestOverdueDays: number | null
  dueToday: number
  waiting: number
}

/** 한 기간 요약(지표 모듈) — 분모 0 인 값은 null(화면은 「—」). */
export interface MetricsSummary {
  completed: number
  completedWithAi: number
  created: number
  onTime: number
  overdue: number
  noDue: number
  overdueLateDaysAvg: number | null
  onTimeRate: number | null
  leadTimeDaysAvg: number | null
  leadTimeDaysMedian: number | null
}

/** 추이 한 칸 — 빈 칸도 0 으로 온다. */
export interface MetricsBucket {
  start: string
  end: string
  completed: number
  overdue: number
  created: number
}

/** 맡은 이슈 한 줄. */
export interface UpcomingItem {
  issueId: number
  projectKey: string
  number: number
  title: string
  dueDate: string | null
  /** 지금 담당인 AI 이름들. */
  aiNames: string[]
}

/** 맡은 이슈 — 타일은 서로 겹칠 수 있다(other = 「마감 여유·없음」만 앞 셋에 안 드는 것). */
export interface Upcoming {
  openAssigned: number
  overdue: number
  dueSoon: number
  waiting: number
  other: number
  overdueTop: UpcomingItem[]
  dueSoonTop: UpcomingItem[]
  waitingTop: UpcomingItem[]
  otherTop: UpcomingItem[]
}

/** 마감 준수 카드의 늦게 완료한 이슈 한 줄. */
export interface LateItem {
  issueId: number
  projectKey: string
  number: number
  title: string
  lateDays: number
}

/** 개요 한 화면 전체. */
export interface MeOverviewResponse {
  period: MeOverviewPeriod
  granularity: MetricsGranularity
  from: string
  to: string
  /** 직전 같은 기간(같은 길이의 바로 앞 기간) 첫날·마지막 날 — 비교 문구 툴팁에 보인다. */
  previousFrom: string
  previousTo: string
  day: MeDaySummary
  current: MetricsSummary
  previous: MetricsSummary
  buckets: MetricsBucket[]
  upcoming: Upcoming
  /** 늦게 완료한 이슈 상위 2건 — 기간 전체에서 서버가 고른다. */
  lateTop: LateItem[]
}
