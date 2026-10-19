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

// RRULE 문자열 → 폼 모델. null/빈 문자열/미지원 FREQ 는 반복 없음으로.
// startsAt(일정 시작 시각, ISO)을 주면 종료일을 「마지막 회차가 생기는 한국 날짜」로 복원한다(untilToKstDate).
export function parseRRule(rrule: string | null, startsAt?: string): RecurrenceForm {
  if (!rrule) return { ...NONE_FORM }

  // "KEY=VALUE;KEY=VALUE" 를 맵으로 파싱
  const map = new Map<string, string>()
  for (const seg of rrule.split(';')) {
    const [key, value] = seg.split('=')
    if (key && value !== undefined) map.set(key.toUpperCase(), value)
  }

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
