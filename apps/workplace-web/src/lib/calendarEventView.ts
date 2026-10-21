// 일정 상세 보기(읽기 전용) 화면의 표시 문구를 만드는 순수 함수 (WP-708).
// 입력칸 대신 텍스트로 보여 주므로 시간·반복·알림·참석 응답 요약을 사람이 읽는 문장으로 바꾼다.
// 캘린더 화면은 날짜 판정·배치를 브라우저 로컬 타임존으로 하므로(#828) 여기서도 로컬 시각을 쓴다.
// 표기는 ICU 로케일 데이터에 기대지 않고 숫자 부품으로 직접 조립한다(formatters 의 formatListTime 과 같은 이유).
import { isSameDay } from 'date-fns'

import { allDayLocalDate } from '@/lib/calendar'
import { formatLocalDateWithWeekday as dateLabel, localClockParts, WEEKDAY_KO } from '@/lib/formatters'
import { isFormEditableRRule, parseRRule, recurrenceUnitLabel } from '@/lib/recurrence'
import type { Attendee, CalendarEvent, OnlineMeetingProvider, RsvpStatus } from '@/types/calendar'

/**
 * 일정 시간 표시 — 날짜 줄과 시각 줄.
 * - 같은 날 시간 일정: { date: "10월 21일 (수)", time: "오후 3:00 – 4:30" } (오전/오후가 같으면 끝 시각의 접두어 생략).
 *   끝이 정확히 다음 날 0시인 일정(22:00–24:00)도 같은 날로 본다.
 * - 여러 날 시간 일정: 날짜 줄 하나에 "10월 21일 (수) 오후 11:00 – 10월 22일 (목) 오전 1:00", time=null
 * - 종일: { date: "10월 21일 (수)" 또는 "10월 21일 (수) – 10월 23일 (금)", time: "종일" } — 종료는 배타적(다음 날 0시)이라 하루 뺀다.
 */
export function eventTimeLines(
  event: Pick<CalendarEvent, 'startsAt' | 'endsAt' | 'allDay'>,
  now: Date = new Date(),
): { date: string; time: string | null } {
  if (event.allDay) {
    const start = allDayLocalDate(event.startsAt)
    const endExclusive = allDayLocalDate(event.endsAt)
    const last = new Date(endExclusive.getFullYear(), endExclusive.getMonth(), endExclusive.getDate() - 1)
    const date = last > start ? `${dateLabel(start, now)} – ${dateLabel(last, now)}` : dateLabel(start, now)
    return { date, time: '종일' }
  }
  const start = new Date(event.startsAt)
  const end = new Date(event.endsAt)
  const s = localClockParts(start)
  const e = localClockParts(end)
  // 끝 시각은 배타적 — 1ms 앞을 기준으로 같은 날인지 본다(자정에 끝나는 일정이 이틀로 보이지 않게). 길이 0 일정은 끝 그대로.
  const lastInstant = end > start ? new Date(end.getTime() - 1) : end
  if (!isSameDay(start, lastInstant)) {
    return {
      date: `${dateLabel(start, now)} ${s.meridiem} ${s.clock} – ${dateLabel(end, now)} ${e.meridiem} ${e.clock}`,
      time: null,
    }
  }
  const endText = s.meridiem === e.meridiem ? e.clock : `${e.meridiem} ${e.clock}`
  return { date: dateLabel(start, now), time: `${s.meridiem} ${s.clock} – ${endText}` }
}

// 간격 1 일 때의 빈도 문구
const EVERY_ONE = { DAILY: '매일', WEEKLY: '매주', MONTHLY: '매월' } as const

/**
 * 반복 규칙 요약 — "매일", "매주 금요일", "2주마다 금요일", "매월 21일" + 종료("· 11월 18일까지" / "· 10회").
 * 반복이 없으면 null(행을 숨긴다). 요일·날짜는 일정 시작일 기준(종일이면 종일 날짜 기준).
 * MCP 등으로 들어온 BYDAY·YEARLY 같은 규칙은 시작일만으로 풀면 틀린 일정을 말하게 되므로 「반복」으로만 알린다.
 */
export function recurrenceLabel(
  event: Pick<CalendarEvent, 'recurrenceRule' | 'startsAt' | 'allDay'>,
  now: Date = new Date(),
): string | null {
  const rrule = event.recurrenceRule?.trim()
  if (!rrule) return null
  if (!isFormEditableRRule(rrule)) return '반복'
  const rec = parseRRule(rrule, event.startsAt)
  const start = event.allDay ? allDayLocalDate(event.startsAt) : new Date(event.startsAt)
  // 간격 1 은 「매일·매주·매월」, 2 이상은 폼 칸 이름과 같은 단위로 「N주마다」(isFormEditableRRule 통과라 freq 는 NONE 아님)
  const every =
    rec.interval > 1 ? `${rec.interval}${recurrenceUnitLabel(rec.freq)}마다` : EVERY_ONE[rec.freq as keyof typeof EVERY_ONE]
  let base: string
  if (rec.freq === 'DAILY') base = every
  else if (rec.freq === 'WEEKLY') base = `${every} ${WEEKDAY_KO[start.getDay()]}요일`
  else base = `${every} ${start.getDate()}일`
  if (rec.end.type === 'until') {
    const [y, m, d] = rec.end.date.split('-').map(Number)
    const until = `${m}월 ${d}일`
    return `${base} · ${y === now.getFullYear() ? until : `${y}년 ${until}`}까지`
  }
  if (rec.end.type === 'count') return `${base} · ${rec.end.count}회`
  return base
}

/** 알림 분 → "10분 전" / "1시간 전" / "1일 전". 알림이 없으면 null(행을 숨긴다). */
export function reminderLabel(minutes: number | null | undefined): string | null {
  if (minutes == null) return null
  if (minutes === 0) return '시작할 때'
  if (minutes % 1440 === 0) return `${minutes / 1440}일 전`
  if (minutes % 60 === 0) return `${minutes / 60}시간 전`
  return `${minutes}분 전`
}

/** 응답 상태 문구 — 응답 버튼(RsvpControls)과 상세 보기 요약이 같은 말을 쓴다. 객체 순서 = 표시 순서(수락 → 미정 → 거절 → 대기). */
export const RSVP_LABEL: Record<RsvpStatus, string> = {
  ACCEPTED: '수락',
  TENTATIVE: '미정',
  DECLINED: '거절',
  NEEDS_ACTION: '대기',
}

/** 참석 응답 요약 — "수락 2, 미정 1, 대기 2". 0명인 상태는 뺀다. 참석자가 없으면 빈 문자열. */
export function rsvpSummary(attendees: Pick<Attendee, 'rsvpStatus'>[]): string {
  return (Object.entries(RSVP_LABEL) as [RsvpStatus, string][])
    .map(([status, label]) => ({ label, n: attendees.filter((a) => a.rsvpStatus === status).length }))
    .filter(({ n }) => n > 0)
    .map(({ label, n }) => `${label} ${n}`)
    .join(', ')
}

/** 참석자 표시 이름 — 외부 참석자는 이메일(없으면 이름). 편집 칩과 상세 보기가 같이 쓴다. */
export function attendeeDisplayName(a: Pick<Attendee, 'kind' | 'externalEmail' | 'name'>): string {
  return a.kind === 'EXTERNAL' ? (a.externalEmail ?? a.name) : a.name
}

/** 참석자 목록 React key — 내부는 id, 외부는 이메일. 이메일 없는 외부 참석자는 이름이 겹칠 수 있어 순서(index)를 덧붙인다. */
export function attendeeKey(a: Pick<Attendee, 'userId' | 'externalEmail' | 'name'>, index: number): string {
  return a.userId != null ? `u-${a.userId}` : `e-${a.externalEmail ?? `${a.name}-${index}`}`
}

/** 보기 화면 참석자 순서 — 주최자, 나, 나머지(원래 순서 유지). */
export function sortAttendeesForView<T extends Pick<Attendee, 'role' | 'userId'>>(
  attendees: T[],
  myUserId: number | null | undefined,
): T[] {
  const rank = (a: T) => (a.role === 'ORGANIZER' ? 0 : myUserId != null && a.userId === myUserId ? 1 : 2)
  // Array.prototype.sort 는 안정 정렬이라 같은 순위끼리는 원래 순서가 유지된다.
  return [...attendees].sort((a, b) => rank(a) - rank(b))
}

export type TextSegment = { type: 'text'; text: string } | { type: 'link'; text: string; href: string }

// http(s) URL — 공백·꺾쇠·따옴표·한글에서 끊는다. 「…/doc에서 확인」처럼 URL 뒤에 조사를 붙여 쓰는 일이 흔하고,
// 메일·Teams 본문의 한글 경로는 퍼센트 인코딩돼 들어온다. 문장 끝 구두점·짝 없는 닫는 괄호는 아래에서 떼어 낸다.
const URL_RE = /https?:\/\/[^\s<>"'\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]+/g
const TRAILING_PUNCT = '.,;:!?'
const CLOSE_TO_OPEN: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/** URL 끝의 문장 부호와, URL 안에 짝이 없는 닫는 괄호를 떼어 낸다 — 「(https://a.b/c).」 → https://a.b/c, 위키 「Foo_(bar)」는 유지. */
function trimUrlEnd(url: string): string {
  let u = url
  for (;;) {
    const last = u.at(-1)
    if (!last) return u
    if (TRAILING_PUNCT.includes(last)) {
      u = u.slice(0, -1)
      continue
    }
    const open = CLOSE_TO_OPEN[last]
    if (open && u.split(open).length - 1 < u.split(last).length - 1) {
      u = u.slice(0, -1)
      continue
    }
    return u
  }
}

/**
 * 설명 글을 텍스트·링크 조각으로 나눈다 — 보기 화면에서 URL 만 누를 수 있게 한다.
 * 줄바꿈은 텍스트 조각에 그대로 남는다(렌더 쪽 whitespace-pre-wrap). http(s) 만 링크로 만든다(javascript: 등 차단).
 * URL 이 꺾쇠로 감싸진 `<https://…>` 꼴이면(M365 가 텍스트로 바꾼 본문은 링크를 `글자<https://…>` 로 준다) 꺾쇠는 화면에서 뺀다 —
 * 꺾쇠가 URL 의 경계를 확정하므로 이 경우엔 문장부호 다듬기를 하지 않는다.
 */
export function splitTextLinks(text: string): TextSegment[] {
  const out: TextSegment[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index
    const wrapped = start > 0 && text[start - 1] === '<' && text[start + m[0].length] === '>'
    const url = wrapped ? m[0] : trimUrlEnd(m[0])
    const textEnd = wrapped ? start - 1 : start
    if (textEnd > last) out.push({ type: 'text', text: text.slice(last, textEnd) })
    out.push({ type: 'link', text: url, href: url })
    last = start + url.length + (wrapped ? 1 : 0)
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

/** 회의 참가 버튼 문구 — 공급자별로 사람이 부르는 이름을 쓴다. 알 수 없는 공급자는 「온라인 회의 참가」. */
export function joinButtonLabel(provider: OnlineMeetingProvider): string {
  switch (provider) {
    case 'TEAMS':
      return 'Teams 회의 참가'
    case 'MEET':
      return 'Google Meet 참가'
    case 'ZOOM':
      return 'Zoom 회의 참가'
    default:
      return '온라인 회의 참가'
  }
}

// 밑줄만 20자 이상인 줄 — Teams 초대 본문이 안내문 앞뒤를 가르는 구분선
const SEPARATOR_RE = /^_{20,}$/

/** Teams 초대 안내문의 밑줄 구분선 줄인가 — 화면은 이 줄을 밑줄 글자 대신 가는 선으로 그린다(좁은 화면에서 밑줄 80자가 꺾여 두 줄이 되는 것을 막는다). */
export function isMeetingSeparatorLine(line: string): boolean {
  return SEPARATOR_RE.test(line.trim())
}

/** Teams 초대 안내문 덩어리가 차지할 수 있는 최대 줄 수(시작 구분선 포함) — 이 창 밖의 글은 보낸 사람이 쓴 글로 본다. */
const MEETING_BLOCK_WINDOW = 20

/**
 * 설명에서 Teams 초대 안내문 덩어리를 떼어 낸다 — 본문(사람이 쓴 글)과 접어 둘 안내문으로 나눈다.
 * Teams 초대는 80자 밑줄 줄 사이에 「Microsoft Teams 모임 / 참가 / 모임 ID / 암호」와 도움말 링크를 넣는데,
 * 참가 링크는 버튼이 대신하므로 설명에서는 접어 두는 편이 읽기 좋다.
 * 규칙: 밑줄 구분선 다음 첫 비어 있지 않은 줄에 「Microsoft Teams」가 있으면 시작점. 끝은 시작 줄부터 MEETING_BLOCK_WINDOW(20)줄 창 안의
 * 마지막 밑줄 구분선(포함). 창 안에 다른 구분선이 없으면 남은 글이 창 이하일 때만 글 끝까지, 더 길면 창 끝까지가 안내문이다.
 * 창을 두는 이유: 실제 안내문은 구분선이 2~3줄(위·아래, 표시에 따라 중간) 들어간 짧은 덩어리인데, 글 전체의 마지막 구분선을 끝으로 잡으면
 * 보낸 사람이 안내문 뒤에 쓴 서명선(____)·후속 글까지 접혀 버린다. 안내문 뒤에 사람이 쓴 글이 있으면 본문 뒤에 이어 붙인다(잃지 않게).
 * 해당하지 않으면 boilerplate=null 이고 body 는 원문 그대로. 줄바꿈은 \r\n 도 \n 으로 맞춰 다룬다.
 */
export function splitMeetingBoilerplate(text: string): { body: string; boilerplate: string | null } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex((line, i) => {
    if (!isMeetingSeparatorLine(line)) return false
    const next = lines.slice(i + 1).find((l) => l.trim() !== '')
    return next !== undefined && next.includes('Microsoft Teams')
  })
  if (start < 0) return { body: text, boilerplate: null }
  // 끝 — 창(시작 줄 포함 MEETING_BLOCK_WINDOW 줄) 안의 마지막 구분선. 없으면 남은 글이 창 이하일 때만 글 끝까지, 아니면 창 끝까지.
  const windowEnd = Math.min(lines.length - 1, start + MEETING_BLOCK_WINDOW - 1)
  let end = -1
  for (let i = windowEnd; i > start; i--) {
    if (isMeetingSeparatorLine(lines[i])) {
      end = i
      break
    }
  }
  if (end < 0) end = windowEnd
  const before = lines.slice(0, start).join('\n').trimEnd()
  const after = lines
    .slice(end + 1)
    .join('\n')
    .trim()
  return {
    body: [before, after].filter((part) => part !== '').join('\n\n'),
    boilerplate: lines.slice(start, end + 1).join('\n').trim(),
  }
}
