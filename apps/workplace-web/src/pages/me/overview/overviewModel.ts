// 「내 작업 · 개요」(WP-1484) 화면 판정 — 기간·칸 라벨, 비교 기간 표기, 숫자 표기, 할당 탭 완료 목록 주소. 렌더와 분리해 순수 함수 테스트로 고정한다.
// 숫자 자체는 서버(지표 모듈)가 계산한다 — 여기서는 보이는 모양만 정한다(설계: AI·화면이 숫자를 지어내지 않는다).
import { daysBetween } from '@/lib/closedRange'
import { EMPTY_GLYPH, formatLocalDateWithWeekday, parseDateKey } from '@/lib/formatters'
import type { MeOverviewPeriod, MetricsBucket, MetricsGranularity, UpcomingItem } from '@/types/meOverview'

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

// 날짜 키 산술은 closedRange 의 UTC 자정 계산을 그대로 쓴다(같은 함수를 두 벌 두지 않게). 화면 컴포넌트가 이 모듈에서 가져가도록 다시 내보낸다.
export { daysBetween }

/** 날짜 키 → 「11월 10일 (월)」(올해가 아니면 연도까지). now 는 「올해」 기준. */
export function dayLabel(key: string, now: Date = new Date()): string {
  return formatLocalDateWithWeekday(parseDateKey(key), now)
}

/**
 * 직전 같은 기간 툴팁 — 「10월 21일~31일과 비교」. 서버는 같은 길이의 바로 앞 기간과 비교하므로(달력상 지난달이 아니다) 실제 날짜를 보여 준다.
 * 같은 달이면 뒤 날짜의 달을 줄이고, 달이 다르면 「10월 26일~11월 1일」, 해가 다르면 연도까지, 하루면 「11월 8일과 비교」.
 */
export function compareRangeLabel(from: string, to: string): string {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  let range: string
  if (from === to) range = `${fm}월 ${fd}일`
  else if (fy !== ty) range = `${fy}년 ${fm}월 ${fd}일~${ty}년 ${tm}월 ${td}일`
  else if (fm !== tm) range = `${fm}월 ${fd}일~${tm}월 ${td}일`
  else range = `${fm}월 ${fd}일~${td}일`
  return `${range}과 비교`
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

/** 하루 평균 완료 건수 — 소수 첫째 자리. 기간 일수 0 은 0. */
export function dailyAverage(completed: number, days: number): string {
  if (days <= 0) return '0'
  const r = Math.round((completed / days) * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/** 맡은 이슈 줄 오른쪽 마감 표기 — 지난 것 「n일 지남」(빨강), 오늘 「오늘 마감」, 남은 것 「n일 남음」, 없음 「마감 없음」. */
export function upcomingDueLabel(item: Pick<UpcomingItem, 'dueDate'>, today: string): { label: string; overdue: boolean } {
  if (!item.dueDate) return { label: '마감 없음', overdue: false }
  const diff = daysBetween(today, item.dueDate)
  if (diff < 0) return { label: `${-diff}일 지남`, overdue: true }
  if (diff === 0) return { label: '오늘 마감', overdue: false }
  return { label: `${diff}일 남음`, overdue: false }
}

/**
 * 할당 탭 완료 목록 주소 — 「완료한 이슈」 카드(기간 전체)와 추이 막대(그 칸의 기간)가 쓴다. 완료일 기간(closedIn 직접 지정 토큰)을 걸고,
 * status=DONE 으로 취소된 이슈를 뺀다 — 카드 숫자는 완료(DONE)만 세기 때문이다. 남는 차이: 카드는 「닫힐 때 내가 담당」, 할당 탭은 「지금 내가 담당」이라
 * 닫은 뒤 담당을 바꾼 이슈는 숫자와 목록이 어긋날 수 있다(할당 탭 뜻은 바꾸지 않는다).
 */
export function closedListHref(from: string, to: string): string {
  const sp = new URLSearchParams({ status: 'DONE', closedIn: `${from}~${to}` })
  return `/me/tasks/assigned?${sp.toString()}`
}

/**
 * 타일 고르기(맡은 이슈·프로젝트 개요 「살펴볼 이슈」, WP-1478) — 사용자가 누른 타일과 그때의 데이터.
 * 데이터가 바뀌었는지 참조로 알아 본다(쿼리 structural sharing 이라 안 바뀌면 같은 참조).
 */
export type TileChoice<K extends string, S> = { key: K; source: S }

/**
 * 보일 타일 — 고른 적 없으면 first(건수 있는 첫 타일). 고른 타일은 그 데이터 그대로면(빈 타일을 눌러 「없어요」를 보는 중이어도) 유지하고,
 * 데이터가 바뀌어 그 타일이 0건이 되면 first 로 돌아간다(다른 탭에서 이슈를 닫아 묶음이 비었을 때 빈 칸에 멈추지 않게).
 * count 는 타일의 건수.
 */
export function visibleTile<K extends string, S>(choice: TileChoice<K, S> | null, source: S, count: (key: K) => number, first: K): K {
  if (choice && (choice.source === source || count(choice.key) > 0)) return choice.key
  return first
}
