// 「내 작업 · 개요」(WP-1484) 화면 판정 — 기간·칸 라벨, 마감 배지, 날짜 묶음, 숫자 표기. 렌더와 분리해 순수 함수 테스트로 고정한다.
// 숫자 자체는 서버(지표 모듈)가 계산한다 — 여기서는 보이는 모양만 정한다(설계: AI·화면이 숫자를 지어내지 않는다).
import { daysBetween } from '@/lib/closedRange'
import { EMPTY_GLYPH, formatLocalDateWithWeekday, parseDateKey } from '@/lib/formatters'
import type { ClosedItem, MeOverviewPeriod, MetricsBucket, MetricsGranularity, UpcomingItem } from '@/types/meOverview'

/** 기간 고르기 — 탭 줄 오른쪽 순서·문구 고정. */
export const PERIOD_OPTIONS: { value: MeOverviewPeriod; label: string }[] = [
  { value: 'WEEK', label: '이번 주' },
  { value: 'MONTH', label: '이번 달' },
  { value: 'QUARTER', label: '최근 3개월' },
]

/** 추이 칸 단위 — 일별(기본) / 주별 / 월별. */
export const GRANULARITY_OPTIONS: { value: MetricsGranularity; label: string }[] = [
  { value: 'DAY', label: '일별' },
  { value: 'WEEK', label: '주별' },
  { value: 'MONTH', label: '월별' },
]

/** 기간을 담는 URL 쿼리 키 — 공유·새로고침해도 같은 기간. 기본(이번 달)은 주소에 적지 않는다. */
export const PERIOD_PARAM = 'period'

/** URL 원값 → 기간. 모르는 값·없음은 기본 「이번 달」(서버도 같은 기본값). */
export function parsePeriod(raw: string | null): MeOverviewPeriod {
  return PERIOD_OPTIONS.some((o) => o.value === raw) ? (raw as MeOverviewPeriod) : 'MONTH'
}

/** 기간 라벨(카드 머리 「끝낸 이슈 · 이번 달」). */
export function periodLabel(p: MeOverviewPeriod): string {
  return PERIOD_OPTIONS.find((o) => o.value === p)?.label ?? ''
}

// 날짜 키 산술은 closedRange 의 UTC 자정 계산을 그대로 쓴다(같은 함수를 두 벌 두지 않게). 화면 컴포넌트가 이 모듈에서 가져가도록 다시 내보낸다.
export { daysBetween }

/** 날짜 키 → 「11월 10일 (월)」(올해가 아니면 연도까지). now 는 「올해」 기준. */
export function dayLabel(key: string, now: Date = new Date()): string {
  return formatLocalDateWithWeekday(parseDateKey(key), now)
}

/** 날짜 키 → 「11월 10일」(축 눈금용 짧은 표기). */
function shortDay(key: string): string {
  const [, m, d] = key.split('-').map(Number)
  return `${m}월 ${d}일`
}

/** 추이 칸 라벨 — 일별 「11월 10일 (월)」, 주별 「11월 3일 ~ 11월 9일」, 월별 「11월」. 툴팁·막대 aria-label 이 쓴다. */
export function bucketLabel(b: MetricsBucket, g: MetricsGranularity, now: Date = new Date()): string {
  if (g === 'DAY') return dayLabel(b.start, now)
  if (g === 'MONTH') return `${Number(b.start.split('-')[1])}월`
  return b.start === b.end ? shortDay(b.start) : `${shortDay(b.start)} ~ ${shortDay(b.end)}`
}

/** 축 눈금 라벨(짧게) — 일별·주별은 「11월 10일」, 월별은 「11월」. */
export function bucketTick(b: MetricsBucket, g: MetricsGranularity): string {
  return g === 'MONTH' ? `${Number(b.start.split('-')[1])}월` : shortDay(b.start)
}

/** 일수 표기 — 소수 첫째 자리(끝의 .0 은 뺀다): 2.8일, 3일. 값 없음(null)은 「—」. */
export function formatDays(n: number | null | undefined): string {
  if (n == null) return EMPTY_GLYPH
  const r = Math.round(n * 10) / 10
  return `${Number.isInteger(r) ? r : r.toFixed(1)}일`
}

/** 비율(0~1) → 「86%」. 분모 0(null)은 「—」. */
export function formatRate(rate: number | null | undefined): string {
  return rate == null ? EMPTY_GLYPH : `${Math.round(rate * 100)}%`
}

/** 하루 평균 끝낸 건수 — 소수 첫째 자리. 기간 일수 0 은 0. */
export function dailyAverage(completed: number, days: number): string {
  if (days <= 0) return '0'
  const r = Math.round((completed / days) * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

export type BadgeTone = 'success' | 'warning' | 'muted'

/** 끝낸 이슈 마감 배지 — 기한 내 / n일 늦음 / 마감 없음. */
export function dueBadge(item: Pick<ClosedItem, 'outcome' | 'lateDays'>): { label: string; tone: BadgeTone } {
  if (item.outcome === 'ON_TIME') return { label: '기한 내', tone: 'success' }
  if (item.outcome === 'OVERDUE') return { label: `${item.lateDays ?? 1}일 늦음`, tone: 'warning' }
  return { label: '마감 없음', tone: 'muted' }
}

/** 앞으로 할 일 줄 오른쪽 마감 표기 — 지난 것 「n일 지남」(빨강), 오늘 「오늘 마감」, 남은 것 「n일 남음」, 없음 「마감 없음」. */
export function upcomingDueLabel(item: Pick<UpcomingItem, 'dueDate'>, today: string): { label: string; overdue: boolean } {
  if (!item.dueDate) return { label: '마감 없음', overdue: false }
  const diff = daysBetween(today, item.dueDate)
  if (diff < 0) return { label: `${-diff}일 지남`, overdue: true }
  if (diff === 0) return { label: '오늘 마감', overdue: false }
  return { label: `${diff}일 남음`, overdue: false }
}

/** 끝낸 일 날짜 묶음 한 칸 — 날짜 줄에 그날 합계(끝냄·만듦). */
export interface ClosedDayGroup {
  date: string
  completed: number
  created: number
  items: ClosedItem[]
}

/**
 * 끝낸 이슈를 닫힌 날짜별로 묶는다(최근 날짜 먼저, 묶음 안은 서버 순서 = 최근 끝낸 순).
 * 날짜 줄 합계는 서버의 일별 칸(dailyTotals)에서 가져온다 — 끝냄은 목록 건수와 같고, 만듦은 목록에 없는 숫자라서.
 */
export function groupClosedByDate(closed: ClosedItem[], dailyTotals: MetricsBucket[]): ClosedDayGroup[] {
  const totals = new Map(dailyTotals.map((b) => [b.start, b]))
  const groups: ClosedDayGroup[] = []
  for (const item of closed) {
    const last = groups[groups.length - 1]
    if (last && last.date === item.closedDate) {
      last.items.push(item)
      continue
    }
    const t = totals.get(item.closedDate)
    groups.push({ date: item.closedDate, completed: t?.completed ?? 0, created: t?.created ?? 0, items: [item] })
  }
  // 서버 집계와 목록이 어긋나도(경합) 끝냄은 적어도 보이는 줄 수만큼.
  for (const g of groups) g.completed = Math.max(g.completed, g.items.length)
  return groups
}

/** 막대로 고른 칸(start~end) 안에 닫힌 묶음만 — 일별이면 그날, 주별·월별이면 그 칸 범위. */
export function groupsInRange(groups: ClosedDayGroup[], range: { start: string; end: string } | null): ClosedDayGroup[] {
  if (!range) return groups
  return groups.filter((g) => g.date >= range.start && g.date <= range.end)
}

/** 고른 칸(start~end) 안 일별 칸의 끝냄 합 — 목록이 잘려 그 칸 줄이 없어도 그날 끝낸 일이 있었는지 안다. */
export function completedInRange(dailyTotals: MetricsBucket[], range: { start: string; end: string }): number {
  return dailyTotals.filter((b) => b.start >= range.start && b.start <= range.end).reduce((sum, b) => sum + b.completed, 0)
}

/** 「모두 보기」 주소 — 할당 탭의 완료 목록에 완료일 기간(closedIn 직접 지정 토큰)을 건다(「완료 모두 보기」와 같은 목록 화면). */
export function closedListHref(from: string, to: string): string {
  const sp = new URLSearchParams({ status: 'DONE', closedIn: `${from}~${to}` })
  return `/me/tasks/assigned?${sp.toString()}`
}
