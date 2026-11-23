// AI 처리 이력 화면의 주소·요청 변환과 표시 함수(WP-1825) — 순수 함수만 둔다.
// 주소 파라미터 이름·순서는 개요의 historyHref 와 같아 개요 → 이력 이동이 그대로 필터가 된다.
import type {
  AiRunActor,
  AiRunActorType,
  AiRunListItem,
  AiRunsParams,
  AiRunStatus,
  AiRunTarget,
  AiStatusPeriod,
} from '@/api/aiStatus'
import { AI_STATUS_PERIODS } from '@/api/aiStatus'
import type { StatusBadgeType } from '@/components/ui/status-badge'
import { issuePath } from '@/lib/appUrl'
import { clock24, EMPTY_GLYPH, formatDateTime, formatDateTimeMinute, formatMonthDayClock, formatNumber, parseUtcDate } from '@/lib/formatters'

/** 처리 이력 필터 — 주소와 1:1. period 는 from·to 가 없을 때의 조회 기간이다. */
export interface RunsFilter {
  period: AiStatusPeriod
  from: string | null
  to: string | null
  kinds: string[]
  status: AiRunStatus | null
  actorType: AiRunActorType | null
  model: string | null
  q: string
}

const DEFAULT_PERIOD: AiStatusPeriod = '24h'

/** 기간 코드 → 밀리초. */
const PERIOD_MS: Record<AiStatusPeriod, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
}

/** 처리 상태 선택지(필터·배지 공용). */
export const RUN_STATUS_OPTIONS: { value: AiRunStatus; label: string }[] = [
  { value: 'SUCCEEDED', label: '완료' },
  { value: 'FAILED', label: '실패' },
  { value: 'RUNNING', label: '진행 중' },
  { value: 'PENDING', label: '시작 전' },
  { value: 'SKIPPED', label: '건너뜀' },
]

/** 실행 주체 종류 선택지. */
export const ACTOR_TYPE_OPTIONS: { value: AiRunActorType; label: string }[] = [
  { value: 'AUTO', label: '자동' },
  { value: 'USER', label: '사람' },
  { value: 'AGENT', label: 'AI' },
]

/**
 * 서버가 받는 ISO-8601 instant 꼴(Java Instant.parse 와 같은 틀 — 초까지 있어야 하고 시간대 Z 또는 ±hh:mm).
 * 월·일·시·분·초의 범위도 본다(Date.parse 는 「T24:00:00Z」를 받지만 서버는 400).
 */
const ISO_INSTANT = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

/** 시각 문자열이 엄격한 ISO-8601 instant 이고 그 달에 있는 날이면 그대로, 아니면 null — 손으로 고친 값이 서버로 나가 400 이 되지 않게(WP-1825 리뷰 후속). */
function validInstant(v: string | null): string | null {
  const m = v === null ? null : ISO_INSTANT.exec(v)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  // 2월 30일처럼 넘치는 날은 Date 가 다음 달로 굴리므로 되돌려 대조한다
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null
  return v
}

/** 「미래 from」 판정에 두는 여유 — 브라우저 시계가 서버보다 늦어도 개요에서 고른 최근 구간을 잃지 않게. */
const FUTURE_SKEW_MS = 5 * 60_000

/**
 * 주소 → 필터. 알 수 없는 값은 기본값으로 떨어뜨려 손으로 고친 주소에도 화면이 깨지지 않게 한다.
 * 구간은 서버가 400 으로 거절할 값을 미리 버린다 — 꼴이 틀린 값, from 보다 앞선 to, to 없는 미래 from.
 * nowMs 는 「미래」 판정 기준(테스트용 — 기본은 지금).
 */
export function parseHistorySearch(sp: URLSearchParams, nowMs: number = Date.now()): RunsFilter {
  const period = sp.get('period')
  const status = sp.get('status')
  const actorType = sp.get('actorType')
  const rawFrom = validInstant(sp.get('from'))
  const fromMs = rawFrom === null ? NaN : Date.parse(rawFrom)
  // to 는 from 보다 앞이 아닐 때만(같아도 서버가 받는다 — 빈 구간). from 없이 to 만 있으면 화면에 칩이 없는 숨은 조건이 되므로 버린다
  const rawTo = rawFrom === null ? null : validInstant(sp.get('to'))
  const to = rawTo !== null && Date.parse(rawTo) >= fromMs ? rawTo : null
  // to 없는 미래 from 은 서버가 400(from > 지금)이라 버린다 — 뒤에 to 가 있으면 서버가 받으므로 둔다. 시계 차이는 여유를 둔다
  const from = to !== null || fromMs <= nowMs + FUTURE_SKEW_MS ? rawFrom : null
  return {
    period: AI_STATUS_PERIODS.find((p) => p === period) ?? DEFAULT_PERIOD,
    from,
    to,
    kinds: [...new Set(sp.getAll('kind').filter((k) => k !== ''))],
    status: RUN_STATUS_OPTIONS.find((o) => o.value === status)?.value ?? null,
    actorType: ACTOR_TYPE_OPTIONS.find((o) => o.value === actorType)?.value ?? null,
    model: sp.get('model')?.trim() || null,
    // 글자가 있는 값은 앞뒤 공백까지 그대로 둔다(검색 칸이 「abc 」를 치는 중 되돌아온 값으로 공백이 지워지지 않게) — 공백뿐이면 빈 값. 요청에서 깎는다.
    q: sp.get('q')?.trim() ? (sp.get('q') ?? '') : '',
  }
}

/** 필터 → 주소. 기본값·빈 값은 넣지 않고 키 순서는 개요 historyHref 와 같다(period·kind·status 뒤에 이 화면 키). */
export function toHistorySearch(f: RunsFilter): URLSearchParams {
  const sp = new URLSearchParams()
  if (f.period !== DEFAULT_PERIOD) sp.set('period', f.period)
  for (const kind of f.kinds) sp.append('kind', kind)
  if (f.status) sp.set('status', f.status)
  if (f.actorType) sp.set('actorType', f.actorType)
  if (f.model) sp.set('model', f.model)
  if (f.q) sp.set('q', f.q)
  if (f.from) sp.set('from', f.from)
  if (f.to) sp.set('to', f.to)
  return sp
}

/** 기간 외 조건이 하나라도 있는가 — 「필터 초기화」 노출 기준. */
export function hasNarrowing(f: RunsFilter): boolean {
  return (
    f.from !== null ||
    f.to !== null ||
    f.kinds.length > 0 ||
    f.status !== null ||
    f.actorType !== null ||
    f.model !== null ||
    f.q !== ''
  )
}

/** 기간만 남기고 조건을 모두 지운다. */
export function clearNarrowing(f: RunsFilter): RunsFilter {
  return { period: f.period, from: null, to: null, kinds: [], status: null, actorType: null, model: null, q: '' }
}

/** 필터 → 서버 요청 파라미터. 구간(from·to)이 있으면 기간을 무시하고, 없으면 baseMs 에서 기간만큼 거슬러 올라간다. */
export function toRunsParams(f: RunsFilter, baseMs: number): AiRunsParams {
  const params: AiRunsParams = {}
  if (f.kinds.length > 0) params.kind = f.kinds
  if (f.status) params.status = f.status
  if (f.actorType) params.actorType = f.actorType
  if (f.model) params.model = f.model
  if (f.q.trim()) params.q = f.q.trim()
  if (f.from || f.to) {
    if (f.from) params.from = f.from
    if (f.to) params.to = f.to
  } else {
    params.from = new Date(baseMs - PERIOD_MS[f.period]).toISOString()
  }
  return params
}

/**
 * 기준 시각을 다시 잡을지 가르는 열쇠 — 기간에서 거슬러 계산하는 from 을 뺀 정규화된 요청 조건(검색어는 깎은 값).
 * 검색어 끝 공백만 바뀌는 것처럼 요청이 같으면 열쇠도 같아 1페이지부터 다시 받지 않는다(WP-1825 리뷰 후속).
 */
export function runsBaseKey(f: RunsFilter): string {
  // baseMs 0 으로 계산한 from 은 기간마다 같은 값이라 기간을 대신 담는다(구간이 있으면 구간 그대로)
  return JSON.stringify(toRunsParams(f, 0))
}

/** 구간 칩 글자 — 로컬 시각. 같은 날이면 뒤쪽 날짜를 줄이고, to 가 없으면 「이후」. */
export function rangeChipLabel(from: string, to: string | null): string {
  const f = parseUtcDate(from)
  if (to === null) return `구간 ${formatMonthDayClock(from)} 이후`
  const t = parseUtcDate(to)
  // 연도가 다르면 월/일만으로는 짧은 구간처럼 읽히므로 양쪽 모두 연도까지 쓴다
  if (f.getFullYear() !== t.getFullYear()) return `구간 ${formatDateTimeMinute(from)}–${formatDateTimeMinute(to)}`
  const sameDay = f.getMonth() === t.getMonth() && f.getDate() === t.getDate()
  return `구간 ${formatMonthDayClock(from)}–${sameDay ? clock24(t) : formatMonthDayClock(to)}`
}

/** 기간만 담은 주소 검색부(`?period=7d`, 기본 기간이면 빈 문자열) — 탭 이동 때 기간만 가져간다. */
export function periodSearch(sp: URLSearchParams): string {
  const s = toHistorySearch(clearNarrowing(parseHistorySearch(sp))).toString()
  return s ? `?${s}` : ''
}

/** 상태 코드 → 화면 이름. 모르는 코드는 그대로. */
export function runStatusLabel(s: string): string {
  return RUN_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s
}

/** 상태 코드 → 배지 종류. */
export function runStatusBadge(s: string): StatusBadgeType {
  switch (s) {
    case 'SUCCEEDED':
      return 'success'
    case 'FAILED':
      return 'error'
    case 'RUNNING':
      return 'info'
    case 'PENDING':
      return 'pending'
    case 'SKIPPED':
      return 'inactive'
    default:
      return 'unknown'
  }
}

/** 실행 주체 글자 — 없음·자동은 「자동」, 이름 없는 계정은 「알 수 없음」. */
export function actorText(a: AiRunActor | null): string {
  if (a === null || a.type === 'AUTO') return '자동'
  return a.name ?? '알 수 없음'
}

const ISSUE_KEY = /^([A-Z][A-Z0-9_]*)-(\d+)$/

/** 대상 → 이동 주소. 이슈만 갈 곳이 있고 메일·파일은 계정·공간 정보가 없어 글자만 보인다(null). */
export function targetHref(t: AiRunTarget | null): string | null {
  if (t?.type !== 'ISSUE' || t.id === null) return null
  const m = ISSUE_KEY.exec(t.id)
  return m ? issuePath(m[1], Number(m[2])) : null
}

/** 대상 글자 — 이름, 없으면 id, 둘 다 없으면 빈 값 표기. */
export function targetText(t: AiRunTarget | null): string {
  // 빈 label('')도 「없음」으로 보고 다음 값을 쓴다
  return t?.label || t?.id || EMPTY_GLYPH
}

/** 토큰 글자 「입력 / 출력」 — 둘 다 없으면 빈 값 표기. */
export function tokensText(input: number | null, output: number | null): string {
  if (input === null && output === null) return EMPTY_GLYPH
  return `${formatNumber(input ?? 0)} / ${formatNumber(output ?? 0)}`
}

/** 처리 시각 — 로컬 YYYY-MM-DD HH:mm:ss. */
export function runTimeText(iso: string | null): string {
  return iso === null ? EMPTY_GLYPH : formatDateTime(iso)
}

/** 건수 글자 — 더 있으면 「이상」. */
export function countLabel(n: number, hasMore: boolean): string {
  return `${formatNumber(n)}건${hasMore ? ' 이상' : ''}`
}

/** 상세 API 용 id — 처리(R-)만 상세가 있고 위임 작업(W-)은 null. */
export function runDetailId(id: string): string | null {
  return id.startsWith('R-') ? id.slice(2) : null
}

/** 선택지에 현재 값(들)이 없으면 그 코드(라벨=코드)를 뒤에 더한다 — 주소의 값이 알려진 목록에 없어도 칩이 보이게. */
export function withCurrent(
  options: { value: string; label: string }[],
  current: string | string[] | null,
): { value: string; label: string }[] {
  const extra = (Array.isArray(current) ? current : current ? [current] : []).filter((c) => !options.some((o) => o.value === c))
  return extra.length > 0 ? [...options, ...extra.map((c) => ({ value: c, label: c }))] : options
}

/** 모델 필터 선택지 — 불러온 목록의 모델(중복 제거) + 지금 걸린 값, 정렬해서. */
export function modelOptions(items: AiRunListItem[], current: string | null): { value: string; label: string }[] {
  const models = [...new Set(items.flatMap((i) => (i.model ? [i.model] : [])))]
  return withCurrent(models.map((v) => ({ value: v, label: v })), current).sort((a, b) => a.value.localeCompare(b.value))
}
