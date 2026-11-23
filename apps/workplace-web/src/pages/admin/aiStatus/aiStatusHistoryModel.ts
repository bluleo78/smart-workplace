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
import { clock24, EMPTY_GLYPH, formatDateTime, formatMonthDayClock, formatNumber, parseUtcDate } from '@/lib/formatters'

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

/** 시각(ISO) 문자열이 해석되면 그대로, 아니면 null. */
function validInstant(v: string | null): string | null {
  return v !== null && v !== '' && !Number.isNaN(Date.parse(v)) ? v : null
}

/** 주소 → 필터. 알 수 없는 값은 기본값으로 떨어뜨려 손으로 고친 주소에도 화면이 깨지지 않게 한다. */
export function parseHistorySearch(sp: URLSearchParams): RunsFilter {
  const period = sp.get('period')
  const status = sp.get('status')
  const actorType = sp.get('actorType')
  const from = validInstant(sp.get('from'))
  return {
    period: AI_STATUS_PERIODS.find((p) => p === period) ?? DEFAULT_PERIOD,
    from,
    // from 없이 to 만 있으면 버린다 — 화면에 칩이 없는 숨은 조건이 되기 때문
    to: from ? validInstant(sp.get('to')) : null,
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

/** 구간 칩 글자 — 로컬 시각. 같은 날이면 뒤쪽 날짜를 줄이고, to 가 없으면 「이후」. */
export function rangeChipLabel(from: string, to: string | null): string {
  const f = parseUtcDate(from)
  if (to === null) return `구간 ${formatMonthDayClock(from)} 이후`
  const t = parseUtcDate(to)
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
  return t?.label ?? t?.id ?? EMPTY_GLYPH
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
