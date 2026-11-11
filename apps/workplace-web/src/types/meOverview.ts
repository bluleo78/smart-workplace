// 「내 작업 · 개요」 탭(WP-1484) — 백엔드 MeOverviewResponse·MeDaySummary 와 1:1. 날짜는 서울 날짜 키(YYYY-MM-DD).

/** 기간 고르기 — 이번 주 / 이번 달(기본) / 최근 3개월(오늘 포함 90일). */
export type MeOverviewPeriod = 'WEEK' | 'MONTH' | 'QUARTER'

/** 추이 칸 단위 — 일별(기본) / 주별 / 월별. */
export type MetricsGranularity = 'DAY' | 'WEEK' | 'MONTH'

/** 마감 판정 — 닫힌 날과 닫힐 당시 마감일 비교. */
export type DueOutcome = 'ON_TIME' | 'OVERDUE' | 'NO_DUE'

/** 어제 한 일 / 오늘 할 일 — 기간과 무관. 홈 위젯 한 줄도 같은 값(/me/overview/today). */
export interface MeDaySummary {
  yesterday: string
  yesterdayCompleted: number
  yesterdayCompletedWithAi: number
  yesterdayCompletedOnTime: number
  yesterdayCreated: number
  today: string
  overdue: number
  /** 기한 지난 것 중 가장 오래된 것의 지난 날수 — 없으면 null. */
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

/** 앞으로 할 일 한 줄. */
export interface UpcomingItem {
  issueId: number
  projectKey: string
  number: number
  title: string
  dueDate: string | null
  /** 지금 담당인 AI 이름들. */
  aiNames: string[]
}

/** 앞으로 할 일 — 타일은 서로 겹칠 수 있다(「그 밖」만 앞 셋에 안 드는 것). */
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

/** 끝낸 일 한 줄. */
export interface ClosedItem {
  issueId: number
  projectKey: string
  number: number
  title: string
  closedAt: string
  closedDate: string
  dueAtClose: string | null
  outcome: DueOutcome
  lateDays: number | null
  leadTimeDays: number | null
  withAi: boolean
  aiNames: string[]
  /** 요청 내용 — 본문 앞부분 평문. */
  request: string | null
  lastComment: { authorName: string; text: string } | null
}

/** 개요 한 화면 전체. */
export interface MeOverviewResponse {
  period: MeOverviewPeriod
  granularity: MetricsGranularity
  from: string
  to: string
  previousFrom: string
  previousTo: string
  day: MeDaySummary
  current: MetricsSummary
  previous: MetricsSummary
  buckets: MetricsBucket[]
  /** 날짜별 끝냄·만듦(일별) — 끝낸 일 목록 날짜 줄 합계용. */
  dailyTotals: MetricsBucket[]
  upcoming: Upcoming
  /** 끝낸 이슈 — 최근 끝낸 순 최대 50건. */
  closed: ClosedItem[]
  /** 기간에 끝낸 이슈 전체 수 — closed 보다 많으면 목록이 잘렸다(「모두 보기」로 안내). */
  closedTotal: number
  /** 늦은 이슈 상위 2건 — 잘린 목록이 아니라 기간 전체에서 서버가 고른다. */
  lateTop: ClosedItem[]
}
