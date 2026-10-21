// 일정 상세 보기 표시 문구 단위 테스트(WP-708). vitest 는 TZ=Asia/Seoul 로 고정돼 로컬 시각 = KST.
import { describe, expect, it } from 'vitest'

import type { Attendee } from '../types/calendar'
import {
  eventTimeLines,
  recurrenceLabel,
  reminderLabel,
  rsvpSummary,
  sortAttendeesForView,
  splitTextLinks,
} from './calendarEventView'

// 기준 시각 — 2026-10-21(수) KST
const NOW = new Date('2026-10-21T03:00:00Z')

const att = (role: Attendee['role'], userId: number | null, rsvpStatus: Attendee['rsvpStatus'] = 'ACCEPTED'): Attendee => ({
  userId,
  username: null,
  name: `u${userId}`,
  kind: 'HUMAN',
  role,
  rsvpStatus,
  invitedByUserId: null,
  externalEmail: null,
})

describe('eventTimeLines', () => {
  it('같은 날 같은 오후 — 끝 시각의 오전/오후는 생략한다', () => {
    // 15:00–16:30 KST
    expect(
      eventTimeLines({ startsAt: '2026-10-21T06:00:00Z', endsAt: '2026-10-21T07:30:00Z', allDay: false }, NOW),
    ).toEqual({ date: '10월 21일 (수)', time: '오후 3:00 – 4:30' })
  })

  it('오전에서 오후로 넘어가면 양쪽에 오전/오후를 쓴다, 정오는 오후 12시', () => {
    // 11:00–12:30 KST
    expect(
      eventTimeLines({ startsAt: '2026-10-21T02:00:00Z', endsAt: '2026-10-21T03:30:00Z', allDay: false }, NOW).time,
    ).toBe('오전 11:00 – 오후 12:30')
  })

  it('자정을 넘기는 시간 일정은 날짜 줄 하나에 양쪽 날짜·시각을 쓴다', () => {
    // 10/21 23:00 – 10/22 01:00 KST
    expect(
      eventTimeLines({ startsAt: '2026-10-21T14:00:00Z', endsAt: '2026-10-21T16:00:00Z', allDay: false }, NOW),
    ).toEqual({ date: '10월 21일 (수) 오후 11:00 – 10월 22일 (목) 오전 1:00', time: null })
  })

  it('자정에 끝나는 시간 일정은 같은 날로 본다', () => {
    // 22:00–24:00 KST
    expect(
      eventTimeLines({ startsAt: '2026-10-21T13:00:00Z', endsAt: '2026-10-21T15:00:00Z', allDay: false }, NOW),
    ).toEqual({ date: '10월 21일 (수)', time: '오후 10:00 – 오전 12:00' })
  })

  it('길이 0 인 자정 일정은 날짜를 두 번 쓰지 않는다', () => {
    expect(
      eventTimeLines({ startsAt: '2026-10-20T15:00:00Z', endsAt: '2026-10-20T15:00:00Z', allDay: false }, NOW),
    ).toEqual({ date: '10월 21일 (수)', time: '오전 12:00 – 12:00' })
  })

  it('하루 종일 — 배타적 종료(다음 날 0시)는 같은 날로 본다', () => {
    expect(
      eventTimeLines({ startsAt: '2026-10-21T00:00:00Z', endsAt: '2026-10-22T00:00:00Z', allDay: true }, NOW),
    ).toEqual({ date: '10월 21일 (수)', time: '종일' })
  })

  it('여러 날 종일 — 마지막 날까지 범위로', () => {
    expect(
      eventTimeLines({ startsAt: '2026-10-21T00:00:00Z', endsAt: '2026-10-24T00:00:00Z', allDay: true }, NOW).date,
    ).toBe('10월 21일 (수) – 10월 23일 (금)')
  })

  it('올해가 아니면 연도를 붙인다', () => {
    expect(
      eventTimeLines({ startsAt: '2027-01-04T01:00:00Z', endsAt: '2027-01-04T02:00:00Z', allDay: false }, NOW).date,
    ).toBe('2027년 1월 4일 (월)')
  })
})

describe('recurrenceLabel', () => {
  // 시작: 2026-10-23(금) 10:00 KST
  const ev = (recurrenceRule: string | null, over: { startsAt?: string; allDay?: boolean } = {}) => ({
    recurrenceRule,
    startsAt: over.startsAt ?? '2026-10-23T01:00:00Z',
    allDay: over.allDay ?? false,
  })

  it('반복 없음이면 null', () => {
    expect(recurrenceLabel(ev(null), NOW)).toBeNull()
    expect(recurrenceLabel(ev('  '), NOW)).toBeNull()
  })

  it('매일·매주(요일)·매월(날짜)', () => {
    expect(recurrenceLabel(ev('FREQ=DAILY'), NOW)).toBe('매일')
    expect(recurrenceLabel(ev('FREQ=WEEKLY'), NOW)).toBe('매주 금요일')
    expect(recurrenceLabel(ev('FREQ=MONTHLY'), NOW)).toBe('매월 23일')
  })

  it('간격이 2 이상이면 「N주마다」', () => {
    expect(recurrenceLabel(ev('FREQ=WEEKLY;INTERVAL=2'), NOW)).toBe('2주마다 금요일')
    expect(recurrenceLabel(ev('FREQ=DAILY;INTERVAL=3'), NOW)).toBe('3일마다')
    expect(recurrenceLabel(ev('FREQ=MONTHLY;INTERVAL=2'), NOW)).toBe('2개월마다 23일')
  })

  it('종료 — 날짜까지(다른 해면 연도) / 횟수', () => {
    // UNTIL 은 KST 그날 끝(11/18 23:59:59 KST)
    expect(recurrenceLabel(ev('FREQ=WEEKLY;UNTIL=20261118T145959Z'), NOW)).toBe('매주 금요일 · 11월 18일까지')
    expect(recurrenceLabel(ev('FREQ=WEEKLY;UNTIL=20270115T145959Z'), NOW)).toBe('매주 금요일 · 2027년 1월 15일까지')
    expect(recurrenceLabel(ev('FREQ=WEEKLY;COUNT=10'), NOW)).toBe('매주 금요일 · 10회')
  })

  it('시작일만으로 풀 수 없는 규칙(BYDAY·YEARLY 등)은 틀린 요일 대신 「반복」', () => {
    expect(recurrenceLabel(ev('FREQ=WEEKLY;BYDAY=MO,WE,FR'), NOW)).toBe('반복')
    expect(recurrenceLabel(ev('FREQ=MONTHLY;BYDAY=2TU'), NOW)).toBe('반복')
    expect(recurrenceLabel(ev('FREQ=YEARLY'), NOW)).toBe('반복')
  })

  it('종일 반복은 종일 날짜 기준 요일(UTC 자정 저장이어도)', () => {
    expect(recurrenceLabel(ev('FREQ=WEEKLY', { startsAt: '2026-10-23T00:00:00Z', allDay: true }), NOW)).toBe('매주 금요일')
  })
})

describe('reminderLabel', () => {
  it('없음이면 null, 분·시간·일 단위로', () => {
    expect(reminderLabel(null)).toBeNull()
    expect(reminderLabel(0)).toBe('시작할 때')
    expect(reminderLabel(10)).toBe('10분 전')
    expect(reminderLabel(60)).toBe('1시간 전')
    expect(reminderLabel(90)).toBe('90분 전')
    expect(reminderLabel(1440)).toBe('1일 전')
  })
})

describe('rsvpSummary', () => {
  it('수락→미정→거절→대기 순서, 0명은 뺀다', () => {
    expect(
      rsvpSummary([
        att('ATTENDEE', 1, 'NEEDS_ACTION'),
        att('ORGANIZER', 2, 'ACCEPTED'),
        att('ATTENDEE', 3, 'TENTATIVE'),
        att('ATTENDEE', 4, 'ACCEPTED'),
      ]),
    ).toBe('수락 2, 미정 1, 대기 1')
    expect(rsvpSummary([])).toBe('')
  })
})

describe('sortAttendeesForView', () => {
  it('주최자 → 나 → 나머지(원래 순서)', () => {
    const list = [att('ATTENDEE', 1), att('ATTENDEE', 2), att('ORGANIZER', 3), att('ATTENDEE', 4)]
    expect(sortAttendeesForView(list, 4).map((a) => a.userId)).toEqual([3, 4, 1, 2])
  })

  it('내가 누군지 모르면 주최자만 앞으로', () => {
    const list = [att('ATTENDEE', 1), att('ORGANIZER', null)]
    expect(sortAttendeesForView(list, undefined).map((a) => a.userId)).toEqual([null, 1])
  })
})

describe('splitTextLinks', () => {
  it('URL 만 링크 조각으로, 줄바꿈은 텍스트에 남긴다', () => {
    expect(splitTextLinks('Teams 모임\n참가: https://teams.microsoft.com/meet/123?p=a\n암호: x')).toEqual([
      { type: 'text', text: 'Teams 모임\n참가: ' },
      { type: 'link', text: 'https://teams.microsoft.com/meet/123?p=a', href: 'https://teams.microsoft.com/meet/123?p=a' },
      { type: 'text', text: '\n암호: x' },
    ])
  })

  it('문장 끝 구두점·닫는 괄호는 링크에서 뺀다', () => {
    expect(splitTextLinks('회의록(https://a.b/c).')).toEqual([
      { type: 'text', text: '회의록(' },
      { type: 'link', text: 'https://a.b/c', href: 'https://a.b/c' },
      { type: 'text', text: ').' },
    ])
  })

  it('URL 에 붙여 쓴 한글 조사는 링크에서 빼고, 짝이 맞는 괄호는 URL 에 남긴다', () => {
    expect(splitTextLinks('https://example.com/doc에서 확인')).toEqual([
      { type: 'link', text: 'https://example.com/doc', href: 'https://example.com/doc' },
      { type: 'text', text: '에서 확인' },
    ])
    expect(splitTextLinks('참고 https://en.wikipedia.org/wiki/Foo_(bar).')).toEqual([
      { type: 'text', text: '참고 ' },
      { type: 'link', text: 'https://en.wikipedia.org/wiki/Foo_(bar)', href: 'https://en.wikipedia.org/wiki/Foo_(bar)' },
      { type: 'text', text: '.' },
    ])
  })

  it('URL 이 없으면 텍스트 하나, javascript: 같은 다른 스킴은 링크로 만들지 않는다', () => {
    expect(splitTextLinks('javascript:alert(1) 그냥 글')).toEqual([{ type: 'text', text: 'javascript:alert(1) 그냥 글' }])
  })
})
