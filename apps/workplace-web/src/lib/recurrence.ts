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
    // 'YYYY-MM-DD' → 'YYYYMMDDT235959Z' (대시 제거 + UTC 당일 끝)
    const compact = form.end.date.replace(/-/g, '')
    parts.push(`UNTIL=${compact}T235959Z`)
  } else if (form.end.type === 'count') {
    parts.push(`COUNT=${form.end.count}`)
  }

  return parts.join(';')
}

// RRULE 문자열 → 폼 모델. null/빈 문자열/미지원 FREQ 는 반복 없음으로.
export function parseRRule(rrule: string | null): RecurrenceForm {
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
    // 'YYYYMMDD...'(compact) → 'YYYY-MM-DD' 로 복원
    const date = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`
    end = { type: 'until', date }
  } else if (count) {
    end = { type: 'count', count: Number(count) }
  }

  return { freq, interval, end }
}
