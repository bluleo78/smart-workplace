// 개인 보고(WP-1486) 순수 모델 — 「보고서 만들기」 창의 기간 보기·기본값·저장 위치 문구, 「보고서 설정」 창의 시각 보기·다음 보고 줄.
// 날짜는 모두 KST 날짜 키(YYYY-MM-DD)로 다룬다. 계산은 UTC 자정 Date 로 해 브라우저 시간대와 무관하게 같은 답을 낸다.
import { addDays } from '@/lib/closedRange'
import { formatKstMonthDayWeekdayClock } from '@/lib/formatters'
import { HOUR_OPTIONS } from '@/lib/hourOptions'
import type { MeReportKind } from '@/types/meReport'

/** 날짜 키 → UTC 자정 Date(요일·달 계산용 — 산술은 closedRange.addDays). */
function toUtc(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** 그 날짜가 든 주의 월요일 — 보고 주는 월~일이다. */
function mondayOf(key: string): string {
  const dow = toUtc(key).getUTCDay() // 0=일 … 6=토
  return addDays(key, -((dow + 6) % 7))
}

/**
 * 일요일이 그 달 몇째 주인가 — 서버 ReportPeriod.weekOfMonth 와 같은 규칙: 주의 달은 일요일의 달, 1일이 든 주가 1주차.
 * offset = 그 달 1일의 요일(월=0 … 일=6).
 */
function weekOfMonth(sunday: string): number {
  const d = toUtc(sunday)
  const firstDow = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).getUTCDay()
  const offset = (firstDow + 6) % 7
  return Math.ceil((d.getUTCDate() + offset) / 7)
}

/** 「11/9」 — 주 보기 괄호 안 날짜. */
function md(key: string): string {
  const d = toUtc(key)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/** 일일 기본값 — 어제(설계 「어제 한 일」). */
export function defaultDaily(today: string): string {
  return addDays(today, -1)
}

/**
 * 최근 n 주(이번 주 포함, 최신 먼저) — 「11월 2주차 (11/2~8)」. 끝날이 같은 달이면 괄호 뒤 달을 줄이고, 다르면 「10/26~11/1」.
 * 이번 주(진행 중)도 고를 수 있다(P5 — 「지금까지」로 계산).
 */
export function recentWeeks(today: string, n = 8): { weekStart: string; label: string }[] {
  const thisMonday = mondayOf(today)
  return Array.from({ length: n }, (_, i) => {
    const weekStart = addDays(thisMonday, -7 * i)
    const sunday = addDays(weekStart, 6)
    const sameMonth = weekStart.slice(0, 7) === sunday.slice(0, 7)
    const range = `${md(weekStart)}~${sameMonth ? toUtc(sunday).getUTCDate() : md(sunday)}`
    return { weekStart, label: `${toUtc(sunday).getUTCMonth() + 1}월 ${weekOfMonth(sunday)}주차 (${range})` }
  })
}

/** 주간 기본값 — 지난주 월요일. */
export function defaultWeekStart(today: string): string {
  return addDays(mondayOf(today), -7)
}

/** 최근 n 달(이번 달 포함, 최신 먼저) — 이름은 「10월」, 올해(today 기준)가 아니면 「2025년 12월」(겹치지 않게). */
export function recentMonths(today: string, n = 12): { month: string; label: string }[] {
  const [y, m] = today.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    const month = d.toISOString().slice(0, 7)
    const name = `${d.getUTCMonth() + 1}월`
    return { month, label: d.getUTCFullYear() === y ? name : `${d.getUTCFullYear()}년 ${name}` }
  })
}

/** 월간 기본값 — 지난달(「YYYY-MM」). */
export function defaultMonth(today: string): string {
  return recentMonths(today, 2)[1].month
}

/**
 * 저장 위치(읽기 전용) — 「내 노트 › 보고 › 2026년 11월」. 월 폴더는 일일은 그날의 달, 주간은 기간 끝(일요일)의 달, 월간은 그 달(P7).
 * 값이 비면(날짜를 지운 순간) 「내 노트 › 보고」까지만.
 */
export function monthFolderLabel(kind: MeReportKind, value: string): string {
  const base = '내 노트 › 보고'
  if (!value) return base
  const end = kind === 'WEEKLY' ? addDays(value, 6) : kind === 'MONTHLY' ? `${value}-01` : value
  const [y, m] = end.split('-').map(Number)
  return `${base} › ${y}년 ${m}월`
}

/** 자동 일일 시각 보기 — 정시만(서버가 「HH:00」 만 받는다). */
export function hourOptions(): string[] {
  return [...HOUR_OPTIONS]
}

/** 설정 창 「다음 보고 11월 13일 (금) 09:00」 — 서울 시각. now 는 연도 표기(올해가 아니면 연도)를 정하는 기준. */
export function nextRunLabel(iso: string, now: Date = new Date()): string {
  return `다음 보고 ${formatKstMonthDayWeekdayClock(iso, now)}`
}
