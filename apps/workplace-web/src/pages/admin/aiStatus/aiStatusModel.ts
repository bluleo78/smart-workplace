// AI 현황 개요 응답 → 화면 조각 변환 모델(WP-1824) — 서버 응답(AiStatusOverview)을 페이지가 그릴 기간 단추·지표 카드·경고·차트 정의로 옮기는 순수 함수만 둔다.
// 집계·백분위는 서버 값을 그대로 쓰고(재집계 금지), 데이터 없는 구간은 절대 0 으로 바꾸지 않으며, 계열 색은 코드 기준 고정 배정이다.
import type { ReactNode } from 'react'

import type { AiStatusAlert, AiStatusOverview, AiStatusPeriod, KindRow } from '@/api/aiStatus'
import { AI_STATUS_PERIODS } from '@/api/aiStatus'
import type { AlertItem, AlertLevel } from '@/components/metrics/AlertList'
import { colorIndexFor } from '@/components/metrics/chartColors'
import { hasAnyValue } from '@/components/metrics/chartData'
import type { ChartSeries } from '@/components/metrics/chartTypes'
import { aiRunKindLabel } from '@/lib/aiRunKindLabels'
import {
  EMPTY_GLYPH,
  formatCompactNumber,
  formatDurationMs,
  formatInstantMonthDay,
  formatLocalClockTime24,
  formatMonthDayClock,
  formatNumber,
  formatPercent,
  formatPercentPointDiff,
} from '@/lib/formatters'

/** 처리량 차트의 단위 — 토큰 합 또는 건수(서버 Cell 의 두 값). */
export type AiStatusUnit = 'tokens' | 'count'

/** 기간 코드별 화면 라벨 — 코드 목록의 단일 원본은 api 의 AI_STATUS_PERIODS 이고 여기서는 라벨만 둔다. */
const PERIOD_LABELS: Record<AiStatusPeriod, string> = { '1h': '1시간', '24h': '24시간', '7d': '7일', '30d': '30일' }

/** 기간 단추 — 서버가 받는 네 코드와 화면 라벨(기본값 24h). AI_STATUS_PERIODS 에서 파생한다. */
export const PERIOD_OPTIONS: { value: AiStatusPeriod; label: string }[] = AI_STATUS_PERIODS.map((value) => ({
  value,
  label: PERIOD_LABELS[value],
}))

/** 기간 코드 → 화면 라벨(「7일」 등) — 기간 단추와 같은 PERIOD_OPTIONS 에서 찾는다(페이지 안내·처리량 차트 이름이 함께 쓴다). */
export function periodLabel(value: AiStatusPeriod): string {
  return PERIOD_OPTIONS.find((o) => o.value === value)?.label ?? value
}

/** 차트 행 한 줄 — x 축 값은 문자열, 계열 값은 숫자 또는 null(구간 없음). */
export type ChartRow = Record<string, string | number | null>

/** 지표 카드 정의 — StatCard 에 그대로 넘긴다. */
export type StatCardDef = { testId: string; title: string; value: ReactNode; meta: ReactNode; note?: string }

/** 작은 그래프 정의 — ChartCard + TrendChart/StackedBarChart 조립에 필요한 것만 담는다. */
export type SmallGraphDef = {
  testId: string
  title: string
  kind: 'line' | 'bar'
  rows: ChartRow[]
  series: ChartSeries[]
  limit?: { value: number; label: string }
  ariaLabel: string
  /** 값 포매터 — 그래프마다 단위가 다르다(응답 시간 ms · 나머지는 건수). */
  valueFormatter: (v: number) => string
}

/** 처리량의 기타 합산 종류 코드(서버가 쓰는 상수). */
const OTHER = 'OTHER'

/** 차트 x 축 필드 이름 — 설계 §5-3 의 `행 { t, <kinds…> }`. 모델·차트 부품이 모두 이 상수를 쓴다. */
export const X_KEY = 't'

/** null 을 그대로 두고 값이 있을 때만 포매터를 돌린다 — 데이터 없는 칸은 EMPTY_GLYPH 다. 모델과 표가 함께 쓴다. */
export const numberText = (v: number | null | undefined): string => (v == null ? EMPTY_GLYPH : formatNumber(v))
export const compactText = (v: number | null | undefined): string => (v == null ? EMPTY_GLYPH : formatCompactNumber(v))
export const percentText = (v: number | null | undefined): string => (v == null ? EMPTY_GLYPH : formatPercent(v))
export const durationText = (v: number | null | undefined): string => (v == null ? EMPTY_GLYPH : formatDurationMs(v))

/** 하루(초) — 구간이 이보다 짧으면 라벨에 시각이 있어야 같은 날의 막대가 서로 갈린다. */
const DAY_SECONDS = 86_400

/** 날짜까지 붙여야 하는 구간 하한(초) — 3시간 이상 구간은 기간이 여러 날에 걸쳐(7일 = 6시간 구간) 시각만으로는 날이 갈리지 않는다. */
const DATED_CLOCK_MIN_SECONDS = 3 * 3_600

/**
 * 구간 길이(응답 bucketSeconds)별 x 축 표기 — 서버 구간 키는 ISO Instant 라 그대로 그리면 축·툴팁에 원문이 보인다.
 * 기간 코드가 아니라 구간 길이로 고르는 까닭(WP-1824 리뷰): 7일 보기는 6시간 구간이라 날짜만 쓰면 하루 4막대가 같은 라벨·툴팁이 된다.
 * - 하루 이상(30일): 로컬 「n월 d일」
 * - 3시간 이상 하루 미만(7일 6시간): 로컬 「M/D HH:mm」 — 날과 시각을 함께
 * - 그보다 짧음(1시간·24시간): 로컬 HH:mm
 * 해석할 수 없는 값은 원문을 그대로 돌려준다. 모바일에서 행을 다시 묶으면 x 값은 그룹 첫 구간이므로 라벨은 그 묶음의 시작 시각이 된다.
 */
export function xFormatterFor(bucketSeconds: number): (v: unknown) => string {
  const format =
    bucketSeconds >= DAY_SECONDS
      ? formatInstantMonthDay
      : bucketSeconds >= DATED_CLOCK_MIN_SECONDS
        ? formatMonthDayClock
        : formatLocalClockTime24
  return (v) => {
    if (typeof v !== 'string') return v == null ? '' : String(v)
    const label = format(v)
    return label === '' || label === '-' ? v : label
  }
}

/** 종류 코드 → 차트 계열 키 — OTHER 만 'other' 로 바꿔 행과 계열이 같은 키를 쓰게 한다. */
function seriesKey(kind: string): string {
  return kind === OTHER ? 'other' : kind
}

/**
 * 처리량 응답을 차트 행으로 — 행 수는 응답 `buckets` 길이로만 정해(keepPreviousData 로 이전 기간의 긴 값 배열이 섞여도 안전),
 * 빈 구간은 null 로 남긴다. x 축 필드는 X_KEY.
 */
export function throughputRows(t: AiStatusOverview['throughput'], unit: AiStatusUnit): ChartRow[] {
  return t.buckets.map((bucket, i) => {
    const row: ChartRow = { [X_KEY]: bucket }
    for (const kind of t.kinds) {
      const cell = t.values[kind]?.[i] ?? null
      row[seriesKey(kind)] = cell == null ? null : ((unit === 'tokens' ? cell.tokens : cell.count) ?? null)
    }
    return row
  })
}

/**
 * 처리량 계열 — OTHER 를 뺀 종류 코드를 오름차순 정렬해 1~5 번을 고정 배정하고(순위로 다시 칠하지 않음),
 * OTHER 는 'other' 색에 「기타 n종」 라벨을 쓴다.
 */
export function throughputSeries(t: AiStatusOverview['throughput']): ChartSeries[] {
  const codes = t.kinds.filter((k) => k !== OTHER).sort()
  const out: ChartSeries[] = codes.map((code, i) => ({
    key: code,
    label: aiRunKindLabel(code),
    // 서버는 상위 5 종류만 내므로 6번째부터는 방어적으로 'other' 색으로 둔다
    colorIndex: colorIndexFor(i),
  }))
  if (t.kinds.includes(OTHER)) {
    out.push({ key: 'other', label: `기타 ${t.otherKindCount}종`, colorIndex: 'other' })
  }
  return out
}

/**
 * 행 다시 묶기(모바일 폭) — `step = Math.ceil(rows.length / maxBars)` 개씩 합치고(전부 null 이면 null),
 * x 값은 그룹 첫 행을 그대로 쓴다. 값의 재배치일 뿐 지표 재집계가 아니다.
 */
export function mergeChartRows(rows: ChartRow[], maxBars: number): ChartRow[] {
  const step = mergeStep(rows.length, maxBars)
  const merged: ChartRow[] = []
  for (let start = 0; start < rows.length; start += step) {
    const group = rows.slice(start, start + step)
    const out: ChartRow = { [X_KEY]: group[0][X_KEY] }
    // 그룹 안 어디에든 나오는 키는 빠지지 않게 모은 뒤 값은 합친다
    const keys = new Set<string>()
    for (const row of group) {
      for (const key of Object.keys(row)) {
        if (key !== X_KEY) keys.add(key)
      }
    }
    for (const key of keys) {
      let sum = 0
      let hasNumber = false
      let firstText: string | null = null
      for (const row of group) {
        const v = row[key]
        if (typeof v === 'number') {
          sum += v
          hasNumber = true
        } else if (v != null && firstText == null) {
          firstText = v
        }
      }
      out[key] = hasNumber ? sum : firstText
    }
    merged.push(out)
  }
  return merged
}

/**
 * 차트 카드의 빈 상태 판정 — 행이 없거나 계열 값이 전부 null 이면 true(`ChartCard` 의 `state='empty'`, 설계 §5-4).
 * 값 0 은 있는 값으로 세고 빈 것으로 치지 않는다.
 */
export function chartIsEmpty(rows: ChartRow[], series: ChartSeries[]): boolean {
  return !hasAnyValue(rows, series)
}

/** 종류 정렬 — 실패율 내림차순(없는 값은 맨 뒤) → 출력 토큰 내림차순(없는 값은 맨 뒤) → 건수 내림차순. */
function compareKindDesc(a: KindRow, b: KindRow): number {
  if (a.failureRate != null || b.failureRate != null) {
    if (a.failureRate == null) return 1
    if (b.failureRate == null) return -1
    if (a.failureRate !== b.failureRate) return b.failureRate - a.failureRate
  }
  if (a.outputTokens != null || b.outputTokens != null) {
    if (a.outputTokens == null) return 1
    if (b.outputTokens == null) return -1
    if (a.outputTokens !== b.outputTokens) return b.outputTokens - a.outputTokens
  }
  return b.count - a.count
}

/** 종류별 표 정렬 — 입력을 바꾸지 않고 정렬한 새 배열을 준다. 값은 그대로 쓴다(요약 행 없음). */
export function sortKinds(kinds: AiStatusOverview['kinds']): KindRow[] {
  return [...kinds].sort(compareKindDesc)
}

/** 계정 사용률 경고의 창 이름 — 서버 라벨 끝의 5h·7d 를 화면 용어(5시간·7일)로 바꾼다. */
const WINDOW_TEXT: Record<string, string> = { '5h': '5시간', '7d': '7일' }

/**
 * 경고 식별자 — 코드·종류·계정·창(라벨)에 순번을 붙여 React 키가 겹치지 않게 한다
 * (한 계정이 5시간·7일 창 모두에서 80% 를 넘으면 같은 코드·계정의 경고가 둘이다).
 */
function alertId(a: AiStatusAlert, i: number): string {
  const parts = [a.code, a.kind, a.accountId, a.label].filter((p) => p != null && p !== '')
  return `${parts.join('-')}-${i}`
}

/** 심각도 → AlertList 수준 — DANGER·WARNING 은 그대로, 그 밖은 INFO 로 둔다. */
function alertLevel(severity: string): AlertLevel {
  if (severity === 'DANGER') return 'danger'
  if (severity === 'WARNING') return 'warning'
  return 'info'
}

/** 경고 머리 문구 — 「<주체> <명사> <값>」 이고 주체·값이 없으면 그 자리를 뺀다. */
function alertHead(subject: string, noun: string, valueText: string | null): string {
  return `${subject} ${noun}${valueText == null ? '' : ` ${valueText}`}`.trimStart()
}

/** 경고 기준 문구 — 기준값이 있을 때만 「기준 <값>」 을 붙인다. */
function alertThreshold(threshold: number | null, format: (v: number) => string): string | null {
  return threshold == null ? null : `기준 ${format(threshold)}`
}

/** 값이 있을 때만 포매터를 돌린다(없으면 null — 머리 문구에서 생략). */
function whenPresent(v: number | null, format: (v: number) => string): string | null {
  return v == null ? null : format(v)
}

/** 계정 경고 라벨(「이름 · 창」) → 이름·꼬리 — 마지막 ' · ' 기준으로 쪼갠다(구분자가 없으면 전체가 이름, 꼬리는 빈 문자열). */
function splitAccountLabel(label: string): { name: string; tail: string } {
  const sep = label.lastIndexOf(' · ')
  if (sep === -1) return { name: label, tail: '' }
  return { name: label.slice(0, sep), tail: label.slice(sep + 3) }
}

/** 경고 종류별 한 줄 문구 — 확정 용어의 명사형이고, 없는 값은 붙이지 않는다(서버가 준 값만 쓴다). */
function alertLabel(a: AiStatusAlert): string {
  let parts: (string | null)[]
  switch (a.code) {
    case 'KIND_FAILURE':
      parts = [
        alertHead(a.kind ? aiRunKindLabel(a.kind) : '', '실패율', whenPresent(a.value, formatPercent)),
        alertThreshold(a.threshold, formatPercent),
      ]
      break
    case 'QUEUE_WAIT': {
      const seconds = (v: number) => formatDurationMs(v * 1000)
      parts = [alertHead('', '최장 대기', whenPresent(a.value, seconds)), alertThreshold(a.threshold, seconds)]
      break
    }
    case 'ACCOUNT_USAGE': {
      const { name, window } = accountParts(a)
      const subject = [name, window].filter(Boolean).join(' ')
      const percent = (v: number) => formatPercent(v / 100)
      parts = [alertHead(subject, '사용률', whenPresent(a.value, percent)), alertThreshold(a.threshold, percent)]
      break
    }
    case 'BACKLOG_STUCK': {
      const count = (v: number) => `${formatNumber(v)}건`
      // 이 경고의 threshold 는 한도가 아니라 60분 전 밀린 건수다(서버 AiStatusAlertEvaluator — 줄지 않고 그대로인지 본다)
      const before = a.threshold == null ? null : `60분 전 ${count(a.threshold)}`
      parts = [alertHead(a.kind ? aiRunKindLabel(a.kind) : '', '밀린 건수', whenPresent(a.value, count)), before]
      break
    }
    default:
      return a.code
  }
  return parts.filter((p) => p != null).join(' · ')
}

/** 경고 한 줄 → AlertList 항목(수준·문구) — 이동 동작은 화면이 alertTarget 으로 링크를 붙인다(모델은 JSX 를 만들지 않는다). */
export function alertItem(a: AiStatusAlert, i: number): AlertItem {
  return { id: alertId(a, i), level: alertLevel(a.severity), label: alertLabel(a) }
}

/** 처리 이력 탭 주소(WP-1825 가 그리는 화면). */
const HISTORY_PATH = '/settings/ai-status/history'

/** AI 계정 관리 화면 — 계정 사용률 경고의 「계정 보기」 가 간다. */
const ACCOUNTS_PATH = '/settings/agents/accounts'

/**
 * 처리 이력 필터 — 주소 파라미터 이름은 이력 조회 API(GET /admin/ai-status/runs)의 것과 같다(kind 반복·status·from·to).
 * period 는 머리 기간 단추 값이고, from·to 가 있으면 이력 화면은 그 구간을 우선한다(처리량 막대 한 칸).
 */
export interface HistoryFilter {
  period?: AiStatusPeriod
  kinds?: string[]
  status?: 'FAILED'
  from?: string
  to?: string
}

/**
 * 개요 → 처리 이력 주소 — 개요의 경고·처리량 막대·종류별 행이 같은 함수로 만들어 파라미터 이름이 갈리지 않게 한다.
 * 기본 기간 24h 는 이력 화면도 기본값이라 주소에 넣지 않는다(개요의 ?period= 규칙과 같다). OTHER(기타 묶음)는 실제 종류가 아니라 넣지 않는다.
 */
export function historyHref(filter: HistoryFilter): string {
  const params = new URLSearchParams()
  if (filter.period && filter.period !== '24h') params.set('period', filter.period)
  for (const kind of filter.kinds ?? []) {
    if (kind !== OTHER) params.append('kind', kind)
  }
  if (filter.status) params.set('status', filter.status)
  if (filter.from) params.set('from', filter.from)
  if (filter.to) params.set('to', filter.to)
  const qs = params.toString()
  return qs === '' ? HISTORY_PATH : `${HISTORY_PATH}?${qs}`
}

/** 경고 한 줄의 이동 — 단추 글자와 주소. 갈 곳이 없는 경고(모르는 코드)는 null. */
export interface AlertTarget {
  label: '이력 보기' | '계정 보기'
  href: string
}

/**
 * 경고 → 이동(설계 §5-3 3) — 종류 실패율은 그 종류의 실패, 밀린 건수는 그 종류의 처리, 최장 대기는 그 기간의 처리 전체(대기 열로 본다)를
 * 이력에서 보고, 계정 사용률은 계정 관리 화면으로 간다. 이력 쪽은 지금 보는 기간을 함께 넘긴다.
 * 밀린 건수·최장 대기에 상태를 걸지 않는 까닭: 줄 선 일은 아직 처리(ai_run)가 아니라 이력의 「시작 전(PENDING)」 은 위임 작업 행만 걸러 엉뚱한 목록이 된다.
 */
export function alertTarget(a: AiStatusAlert, period: AiStatusPeriod): AlertTarget | null {
  const kinds = a.kind ? [a.kind] : undefined
  switch (a.code) {
    case 'KIND_FAILURE':
      return { label: '이력 보기', href: historyHref({ period, kinds, status: 'FAILED' }) }
    case 'BACKLOG_STUCK':
      return { label: '이력 보기', href: historyHref({ period, kinds }) }
    case 'QUEUE_WAIT':
      return { label: '이력 보기', href: historyHref({ period }) }
    case 'ACCOUNT_USAGE':
      return { label: '계정 보기', href: ACCOUNTS_PATH }
    default:
      return null
  }
}

/** 경고 표 한 줄 — AlertList 항목과 그 줄의 이동(없으면 null). */
export interface AlertRow {
  item: AlertItem
  target: AlertTarget | null
}

/** 계정 사용률 경고 코드 — 여러 개여도 개요에서는 한 줄로 묶는다. */
const ACCOUNT_USAGE = 'ACCOUNT_USAGE'

/** 심각도 순위 — 묶은 줄의 수준은 묶인 것 중 가장 높은 것(danger > warning > info). */
const LEVEL_RANK: Record<AlertLevel, number> = { info: 0, warning: 1, danger: 2 }

/** 계정 경고가 가리키는 계정 키 — accountId, 없으면 라벨에서 ` · <창>` 꼬리를 뗀 이름. 둘 다 없으면 null(합치지 않는다). */
function accountKey(a: AiStatusAlert): string | null {
  if (a.accountId != null) return `id:${a.accountId}`
  if (!a.label) return null
  return `name:${accountParts(a).name}`
}

/** 계정 경고가 기준 100% 이상(한도 도달)인가 — 묶은 줄의 「도달」 판정을 한 곳에 둔다. */
function isReached(a: AiStatusAlert): boolean {
  return a.threshold != null && a.threshold >= 100
}

/** 계정 경고 라벨(「이름 · 5h」) → 이름·화면 용어 창(5시간·7일) — 라벨이 없으면 둘 다 빈 문자열. 한 줄 문구와 묶은 줄이 함께 쓴다. */
function accountParts(a: AiStatusAlert): { name: string; window: string } {
  const { name, tail } = splitAccountLabel(a.label ?? '')
  return { name, window: WINDOW_TEXT[tail] ?? tail }
}

/** 빈 값을 빼고 겹치는 값을 한 번만 남겨 「·」 로 잇는다(순서 그대로) — 묶은 줄의 창 목록. */
function joinUnique(values: string[]): string {
  return [...new Set(values.filter(Boolean))].join('·')
}

/**
 * 계정 사용률 경고 둘 이상 → 묶은 한 줄(수준·문구·「계정 보기」 이동).
 * 문구는 「<주체> 한도 도달(기준)」(모두 도달) 또는 「<주체> 한도 근접(가장 낮은 기준% 이상)」 에 도달이 있으면 「 · <도달> 도달」 이다. 기준이 하나도 없으면 괄호를 뺀다.
 * 주체·도달 단위는 서로 다른 계정 수 n 으로 갈린다 — 여럿이면 「AI 계정 n개」·「m개」, 하나면(한 계정이 5시간·7일 두 창에 함께 걸림)
 * 묶어도 어느 계정인지 남게 「<이름> <창·창>」·「<도달한 창>」(예: 「운영 5시간·7일 한도 근접(80% 이상) · 5시간 도달」). 이름을 모르면 개수로 적는다.
 */
function groupAccountAlerts(accountAlerts: AiStatusAlert[]): AlertRow {
  const level = accountAlerts
    .map((x) => alertLevel(x.severity))
    .reduce((top, cur) => (LEVEL_RANK[cur] > LEVEL_RANK[top] ? cur : top))
  // 계정별로 합친다(값 = 그 계정의 경고 중 하나라도 도달) — 키가 없는 경고는 서로 합치지 않고 각각 한 계정으로 센다
  const reachedByAccount = new Map<string, boolean>()
  accountAlerts.forEach((x, i) => {
    const key = accountKey(x) ?? `anon:${i}`
    reachedByAccount.set(key, (reachedByAccount.get(key) ?? false) || isReached(x))
  })
  const n = reachedByAccount.size
  const m = [...reachedByAccount.values()].filter(Boolean).length
  const thresholds = accountAlerts.map((x) => x.threshold).filter((v): v is number => v != null)
  const minThreshold = thresholds.length === 0 ? null : Math.min(...thresholds)
  const criterion = minThreshold == null ? '' : `(${formatPercent(minThreshold / 100)} 이상)`

  const parts = accountAlerts.map(accountParts)
  const name = n === 1 ? parts.find((p) => p.name !== '')?.name : undefined
  const reached = accountAlerts.filter(isReached)
  const subject = name ? [name, joinUnique(parts.map((p) => p.window))].filter(Boolean).join(' ') : `AI 계정 ${n}개`
  const allReached = name ? reached.length === accountAlerts.length : m === n
  // 도달한 것 — 한 계정이면 도달한 창 이름(모르면 생략), 여럿이면 도달한 계정 수
  const reachedUnit = name ? joinUnique(reached.map((x) => accountParts(x).window)) : `${m}개`
  const reachedTail = reached.length === 0 ? '' : ` · ${[reachedUnit, '도달'].filter(Boolean).join(' ')}`
  const label = allReached ? `${subject} 한도 도달${criterion}` : `${subject} 한도 근접${criterion}${reachedTail}`
  return {
    item: { id: `${ACCOUNT_USAGE}-group`, level, label },
    target: { label: '계정 보기', href: ACCOUNTS_PATH },
  }
}

/**
 * 개요 경고 줄 — 계정 사용률 경고(5시간·7일 창 × 계정 수만큼 늘어난다)가 둘 이상이면 첫 계정 경고 자리에 한 줄로 묶고(groupAccountAlerts)
 * 「계정 보기」 로 보낸다. 하나뿐이면 묶지 않고 계정·창·사용률·기준을 그대로 보인다(링크는 같다). 그 밖의 경고는 서버 순서 그대로 한 줄씩이다.
 */
export function alertRows(alerts: AiStatusAlert[], period: AiStatusPeriod): AlertRow[] {
  const accountAlerts = alerts.filter((a) => a.code === ACCOUNT_USAGE)
  const groupAt = accountAlerts.length >= 2 ? alerts.findIndex((a) => a.code === ACCOUNT_USAGE) : -1
  const rows: AlertRow[] = []
  alerts.forEach((a, i) => {
    if (groupAt !== -1 && a.code === ACCOUNT_USAGE) {
      // 묶는 경우 — 첫 계정 경고 자리에 묶음 한 줄, 나머지 계정 경고는 건너뛴다
      if (i === groupAt) rows.push(groupAccountAlerts(accountAlerts))
      return
    }
    rows.push({ item: alertItem(a, i), target: alertTarget(a, period) })
  })
  return rows
}

/**
 * 처리량 막대 한 칸 → 그 시간대의 이력 주소 — from 은 막대의 구간 시작, to 는 거기서 spanSeconds 뒤(미포함, API 의 to 와 같다).
 * 모바일에서 막대를 n개씩 묶었으면 spanSeconds 는 구간 길이 × n 이다. 마지막 묶음은 구간이 n개보다 적을 수 있어
 * to 를 개요 창의 끝(windowEnd)에서 자른다. 시각을 읽을 수 없으면 null(이동하지 않는다).
 */
export function bucketHistoryHref(bucketStart: unknown, spanSeconds: number, windowEnd: string): string | null {
  if (typeof bucketStart !== 'string') return null
  const startMs = Date.parse(bucketStart)
  if (Number.isNaN(startMs) || spanSeconds <= 0) return null
  const endLimit = Date.parse(windowEnd)
  // 창 끝을 읽을 수 없으면 자르지 않는다(구간 끝 그대로)
  const endMs = Math.min(startMs + spanSeconds * 1000, Number.isNaN(endLimit) ? Infinity : endLimit)
  return historyHref({ from: new Date(startMs).toISOString(), to: new Date(endMs).toISOString() })
}

/** 모바일 다시 묶기의 묶음 크기 — mergeChartRows 와 같은 식(막대 하나가 원래 구간 몇 개인지). */
export function mergeStep(rowCount: number, maxBars: number): number {
  return Math.max(1, Math.ceil(rowCount / maxBars))
}

/**
 * 동시 처리 지표 카드의 값·직전 값 표기 「진행 중 / 한도건」 — 아는 값은 두고 모르는 자리만 EMPTY_GLYPH.
 * 단위 「건」 은 값이 있든 없든 늘 끝 한 자리에 둔다(「3 / 8건」·「3 / —건」) — 다른 카드·이전 「n / m 칸」 표기처럼 단위 자리가 값에 따라 옮겨 다니지 않게.
 */
function slotUsageText(used: number | null | undefined, limit: number | null | undefined): string {
  return `${used ?? EMPTY_GLYPH} / ${limit ?? EMPTY_GLYPH}건`
}

/** 동시 처리 값 표기 — 최근 표본이 없으면 '—', 있으면 「n / m건」(설계 §5-1). */
function slotText(slot: AiStatusOverview['metrics']['slotUsage']['current']): string {
  if (slot == null) return EMPTY_GLYPH
  return slotUsageText(slot.used, slot.limit)
}

/** 실패율 카드의 「한도 초과 N건 · 계정 이름」 — 실패율에서 뺀 사용 한도 초과를 따로 알린다. 0건이면 없음(숨김). */
export function limitedNote(limited: number | null | undefined, credentials: string[] | null | undefined): string | undefined {
  if (limited == null || limited <= 0) return undefined
  const names = (credentials ?? []).filter((c) => c !== '')
  return names.length > 0 ? `한도 초과 ${formatNumber(limited)}건 · ${names.join(' · ')}` : `한도 초과 ${formatNumber(limited)}건`
}

/**
 * 지표 6장 정의 — 제목은 설계 §5-4 확정 용어, 아랫줄은 `직전 <값>`(실패율은 퍼센트포인트 차이를 더한다),
 * 토큰 카드는 머리글에 합(compact)·아랫줄에 입력·출력 분해를 쓴다(설계 §5-6 6b).
 */
export function statCards(m: AiStatusOverview['metrics']): StatCardDef[] {
  const tokenMeta = [
    `직전 ${compactText(m.tokens.previous == null ? null : m.tokens.previous.input + m.tokens.previous.output)}`,
    `입력 ${compactText(m.tokens.current.input)}`,
    `출력 ${compactText(m.tokens.current.output)}`,
  ].join(' · ')
  const failureMeta =
    m.failureRate.current != null && m.failureRate.previous != null
      ? `직전 ${formatPercent(m.failureRate.previous)} · ${formatPercentPointDiff(m.failureRate.current, m.failureRate.previous)}`
      : `직전 ${percentText(m.failureRate.previous)}`

  return [
    {
      testId: 'card-runs',
      title: '처리 건수',
      value: numberText(m.runCount.current),
      meta: `직전 ${numberText(m.runCount.previous)}`,
    },
    {
      testId: 'card-tokens',
      title: '토큰',
      value: compactText(m.tokens.current.input + m.tokens.current.output),
      meta: tokenMeta,
    },
    {
      testId: 'card-failure-rate',
      title: '실패율',
      value: percentText(m.failureRate.current),
      meta: failureMeta,
      note: limitedNote(m.limited, m.limitedCredentials),
    },
    {
      testId: 'card-response-time',
      title: '응답 시간',
      value: durationText(m.responseTime.current.p95),
      meta: `p95 · 직전 ${durationText(m.responseTime.previous?.p95)}`,
    },
    {
      testId: 'card-wait-time',
      title: '대기 시간',
      value: durationText(m.waitTime.current.p95),
      meta: `p95 · 직전 ${durationText(m.waitTime.previous?.p95)} · 대기 ${m.waitTime.current.queueWaiting == null ? EMPTY_GLYPH : `${formatNumber(m.waitTime.current.queueWaiting)}건`}`,
    },
    {
      testId: 'card-slot-usage',
      title: '동시 처리',
      value: slotText(m.slotUsage.current),
      meta: `진행 중 / 한도 · 직전 ${slotText(m.slotUsage.previous)}`,
    },
  ]
}

/** 구간 축과 계열 배열들을 행으로 — 행 수는 buckets 기준, 없는 구간은 null 그대로. */
function zipRows(buckets: string[], seriesFields: Record<string, (number | null)[]>): ChartRow[] {
  return buckets.map((bucket, i) => {
    const row: ChartRow = { [X_KEY]: bucket }
    for (const [key, values] of Object.entries(seriesFields)) {
      row[key] = values?.[i] ?? null
    }
    return row
  })
}

/** 구간 배열의 뒤에서 앞으로 보아 남아 있는 마지막 값 — 동시 처리 한도처럼 기준선에 쓴다(전부 null 이면 null). */
function lastValue(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] != null) return values[i]
  }
  return null
}

/**
 * 작은 그래프 5개 정의 — 응답 시간·실패(막대)·대기 / 밀린 건수·동시 처리 순서(계정 사용률은 계정 화면에서 본다).
 */
export function smallGraphs(s: AiStatusOverview['series']): SmallGraphDef[] {
  const backlogKeys = Object.keys(s.backlog).sort()
  const slotLimit = lastValue(s.slotLimit)

  return [
    {
      testId: 'graph-response',
      title: '응답 시간',
      kind: 'line',
      rows: zipRows(s.buckets, { p95: s.responseP95, p50: s.responseP50 }),
      series: [
        { key: 'p95', label: 'p95', colorIndex: 1 },
        { key: 'p50', label: 'p50', colorIndex: 2 },
      ],
      ariaLabel: '기간별 응답 시간(p95·p50)',
      valueFormatter: formatDurationMs,
    },
    {
      testId: 'graph-failures',
      title: '실패',
      kind: 'bar',
      rows: zipRows(s.buckets, { failures: s.failures }),
      series: [{ key: 'failures', label: '실패 건수', colorIndex: 1 }],
      ariaLabel: '기간별 실패 건수',
      valueFormatter: formatNumber,
    },
    {
      testId: 'graph-queue-wait',
      title: '대기',
      kind: 'line',
      rows: zipRows(s.buckets, { queueWaiting: s.queueWaiting }),
      series: [{ key: 'queueWaiting', label: '대기 건수', colorIndex: 1 }],
      ariaLabel: '기간별 대기 건수',
      valueFormatter: formatNumber,
    },
    {
      testId: 'graph-backlog',
      title: '밀린 건수',
      kind: 'line',
      rows: zipRows(s.buckets, s.backlog),
      // 종류 코드 오름차순 고정 배정 — 6번째부터는 기타 회색
      series: backlogKeys.map((key, i) => ({ key, label: aiRunKindLabel(key), colorIndex: colorIndexFor(i) })),
      ariaLabel: '기간별 밀린 건수(종류별)',
      valueFormatter: formatNumber,
    },
    {
      testId: 'graph-slot',
      title: '동시 처리',
      kind: 'line',
      rows: zipRows(s.buckets, { used: s.slotUsed }),
      series: [{ key: 'used', label: '진행 중', colorIndex: 1 }],
      ...(slotLimit == null ? {} : { limit: { value: slotLimit, label: '한도' } }),
      ariaLabel: '기간별 동시 처리(한도 포함)',
      valueFormatter: formatNumber,
    },
  ]
}

/** 머리의 갱신 표기 — 1분 미만은 「갱신 n초 전」, 이후 「n분 전」·「n시간 전」. 기준 시각은 서버의 generatedAt 이고 nowMs 로 지난 시간을 센다. */
export function updatedAgoLabel(generatedAt: string, nowMs: number): string {
  const at = Date.parse(generatedAt)
  const seconds = Number.isFinite(at) ? Math.max(0, Math.floor((nowMs - at) / 1000)) : 0
  if (seconds < 60) return `갱신 ${seconds}초 전`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `갱신 ${minutes}분 전`
  return `갱신 ${Math.floor(minutes / 60)}시간 전`
}