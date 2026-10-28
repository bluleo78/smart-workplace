// 캘린더 반복(RRULE) 폼 모델 ↔ RRULE 문자열 변환 유틸 (이슈 #111).
// 폼에서 다루기 쉬운 RecurrenceForm 과 백엔드가 받는 RRULE 문자열 사이를 양방향 변환한다.

export type RecurrenceFreq = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'

export type RecurrenceEnd =
  | { type: 'none' }
  | { type: 'until'; date: string } // 'YYYY-MM-DD'
  | { type: 'count'; count: number }

export interface RecurrenceForm {
  freq: RecurrenceFreq
  interval: number // >=1
  end: RecurrenceEnd
}

// 반복 회차를 펼치는 기준 시간대 — 서버(RecurrenceExpander, WP-534)와 같은 한국 시간(+09:00, 일광절약 없음). 종료일
// 「YYYY-MM-DD 까지」는 이 시간대의 그날 끝을 뜻한다(WP-535).
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// 'YYYY-MM-DD'(한국 날짜) → 그날 23:59:59 KST 를 RRULE UNTIL(UTC 절대 시각, 'YYYYMMDDTHHMMSSZ')로.
function kstEndOfDayUntil(date: string): string {
  const endUtc = new Date(Date.parse(`${date}T23:59:59Z`) - KST_OFFSET_MS)
  return endUtc.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

// RRULE UNTIL('YYYYMMDDTHHMMSSZ' 또는 날짜만) → 마지막 회차가 생기는 한국 날짜 'YYYY-MM-DD'.
// UNTIL 의 한국 시각이 일정 시작 시각(하루 중 시각)보다 이르면 그날 회차는 생기지 않으므로 전날이다 — 예전 형식(UTC 하루 끝)과
// 「이후 모두」 분할이 만든 UNTIL(다음 회차 1초 전)을 다시 저장해도 회차가 늘지 않게 한다. 시작 시각을 모르면 UNTIL 의 한국 날짜.
function untilToKstDate(until: string, startsAt?: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(until)
  if (!m) return `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`
  // 날짜만(시각 없음)이면 그 날짜 그대로
  if (m[4] === undefined) return `${m[1]}-${m[2]}-${m[3]}`
  const untilKst = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + KST_OFFSET_MS
  let dayStart = untilKst - (untilKst % DAY_MS)
  if (startsAt) {
    const startKst = Date.parse(startsAt) + KST_OFFSET_MS
    if (Number.isFinite(startKst) && untilKst - dayStart < startKst % DAY_MS) dayStart -= DAY_MS
  }
  return new Date(dayStart).toISOString().slice(0, 10)
}

// 반복 없음 기본값 — parse 실패/null 시 공통 반환.
const NONE_FORM: RecurrenceForm = { freq: 'NONE', interval: 1, end: { type: 'none' } }

// 폼 모델 → RRULE 문자열. 반복 없음이면 null.
export function buildRRule(form: RecurrenceForm): string | null {
  // freq 'NONE' → 반복 규칙 자체가 없음
  if (form.freq === 'NONE') return null

  const parts = [`FREQ=${form.freq}`]
  // interval 은 2 이상일 때만 명시(1 은 기본값이므로 생략)
  if (form.interval > 1) parts.push(`INTERVAL=${form.interval}`)

  if (form.end.type === 'until') {
    // 'YYYY-MM-DD' → 한국 시간 그날 끝의 UTC 시각(예: 2026-11-18 → 20261118T145959Z)
    parts.push(`UNTIL=${kstEndOfDayUntil(form.end.date)}`)
  } else if (form.end.type === 'count') {
    parts.push(`COUNT=${form.end.count}`)
  }

  return parts.join(';')
}

/**
 * "KEY=VALUE;KEY=VALUE" → 키(대문자)·값 맵. parseRRule 과 isFormEditableRRule 이 같은 방식으로 읽게 한 곳에 둔다.
 * 개인 작업 반복(lib/issueRecurrence, WP-989)도 같은 토큰화를 쓴다.
 * clean=false: 형식이 깨진 조각이나 같은 키가 두 번 있어 맵이 원문을 다 담지 못했다(같은 키는 뒤엣것이 남는다). 빈 조각(끝의 ;)은 무해.
 */
export function tokenizeRRule(rrule: string): { map: Map<string, string>; clean: boolean } {
  const map = new Map<string, string>()
  let clean = true
  for (const seg of rrule.split(';')) {
    if (seg === '') continue
    const [key, value] = seg.split('=')
    if (!key || value === undefined) {
      clean = false
      continue
    }
    const k = key.toUpperCase()
    if (map.has(k)) clean = false
    map.set(k, value)
  }
  return { map, clean }
}

/** 반복 빈도별 간격 단위 — 폼의 「N주마다」 칸 이름과 상세 보기 반복 문구가 같이 쓴다. */
export function recurrenceUnitLabel(freq: RecurrenceFreq): string {
  switch (freq) {
    case 'DAILY':
      return '일'
    case 'WEEKLY':
      return '주'
    case 'MONTHLY':
      return '개월'
    default:
      return ''
  }
}

// RRULE 문자열 → 폼 모델. null/빈 문자열/미지원 FREQ 는 반복 없음으로.
// startsAt(일정 시작 시각, ISO)을 주면 종료일을 「마지막 회차가 생기는 한국 날짜」로 복원한다(untilToKstDate).
export function parseRRule(rrule: string | null, startsAt?: string): RecurrenceForm {
  if (!rrule) return { ...NONE_FORM }

  const { map } = tokenizeRRule(rrule)

  const freq = map.get('FREQ')
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') {
    // 미지원 FREQ(또는 누락) → 반복 없음
    return { ...NONE_FORM }
  }

  // INTERVAL 기본 1
  const intervalRaw = Number(map.get('INTERVAL'))
  const interval = Number.isFinite(intervalRaw) && intervalRaw >= 1 ? intervalRaw : 1

  // 종료 조건: UNTIL 우선, 없으면 COUNT, 둘 다 없으면 none
  let end: RecurrenceEnd = { type: 'none' }
  const until = map.get('UNTIL')
  const count = map.get('COUNT')
  if (until) {
    end = { type: 'until', date: untilToKstDate(until, startsAt) }
  } else if (count) {
    end = { type: 'count', count: Number(count) }
  }

  return { freq, interval, end }
}

// 반복 폼(RecurrenceForm)이 그대로 옮겨 담을 수 있는 RRULE 토큰. WKST 는 이 앱의 빈도(일·주·월)에선 결과에 영향이 없다.
const FORM_RRULE_KEYS = new Set(['FREQ', 'INTERVAL', 'UNTIL', 'COUNT', 'WKST'])

/**
 * 반복 폼으로 잃는 것 없이 다룰 수 있는 규칙인가 — 반복 없음이거나, FREQ 가 DAILY·WEEKLY·MONTHLY 이고 위 토큰만 있을 때.
 * MCP 등으로 만든 BYDAY(여러 요일)·BYMONTHDAY·YEARLY 같은 규칙은 parseRRule 이 버리거나 반복 없음으로 읽어,
 * 그대로 저장하면 규칙이 바뀌거나 반복이 사라진다(WP-708). 이런 규칙은 폼이 반복 칸을 잠그고 원래 규칙을 보낸다.
 */
export function isFormEditableRRule(rrule: string | null | undefined): boolean {
  if (!rrule?.trim()) return true
  // parseRRule 과 같은 토큰화로 읽어야 「다룰 수 있음」이 손실 없는 왕복을 뜻한다. 깨진 조각·중복 키는 parseRRule 이 버리므로 잠근다.
  const { map, clean } = tokenizeRRule(rrule)
  if (!clean) return false
  // UNTIL·COUNT 가 함께면 parseRRule 이 COUNT 를 버린다
  if (![...map.keys()].every((k) => FORM_RRULE_KEYS.has(k)) || (map.has('UNTIL') && map.has('COUNT'))) return false
  const freq = map.get('FREQ')
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return false
  // 값도 폼이 그대로 되돌려 쓸 수 있어야 한다 — 1 이상의 정수 간격·횟수, UNTIL 은 날짜(·UTC 시각)만.
  const positiveInt = (v: string | undefined) => v === undefined || /^[1-9]\d*$/.test(v)
  const until = map.get('UNTIL')
  return (
    positiveInt(map.get('INTERVAL')) &&
    positiveInt(map.get('COUNT')) &&
    (until === undefined || /^\d{8}(T\d{6}Z)?$/.test(until))
  )
}
