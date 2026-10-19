import { describe, expect, it } from 'vitest'

import type { Attendee, Calendar, CalendarEvent, IssueDueMarker } from '../types/calendar'
import {
  allDayLocalDate,
  type CalendarLayers,
  eventsOnDay,
  groupCalendarsBySource,
  isEventVisible,
  isNotEventOrganizer,
  isoToLocalInput,
  markedDays,
  monthMatrix,
  proposalTimeRange,
  providerLabel,
  timedEventBox,
  toggleCalendar,
  visibleRange,
  weekDays,
} from './calendar'

describe('isNotEventOrganizer (WP-200)', () => {
  const att = (role: Attendee['role'], userId: number | null): Attendee => ({
    userId, username: null, name: 'n', kind: userId == null ? 'EXTERNAL' : 'HUMAN', role,
    rsvpStatus: 'ACCEPTED', invitedByUserId: null, externalEmail: userId == null ? 'x@y.com' : null,
  })

  it('내 역할이 ATTENDEE 면 주최자가 아니다', () => {
    expect(isNotEventOrganizer({ myRole: 'ATTENDEE', attendees: [att('ORGANIZER', 2), att('ATTENDEE', 1)] })).toBe(true)
  })
  it('다른 내부 사용자가 주최자이고 내 행이 없으면 주최자가 아니다', () => {
    expect(isNotEventOrganizer({ myRole: null, attendees: [att('ORGANIZER', 2)] })).toBe(true)
  })
  it('외부 이메일 주최자 + 내 행 없음은 별칭으로 온 내 미팅일 수 있어 막지 않는다', () => {
    expect(isNotEventOrganizer({ myRole: null, attendees: [att('ORGANIZER', null)] })).toBe(false)
  })
  it('내가 ORGANIZER 면 주최자다', () => {
    expect(isNotEventOrganizer({ myRole: 'ORGANIZER', attendees: [att('ORGANIZER', 1)] })).toBe(false)
  })
  it('참석자 정보가 없으면(목록 응답·옛 일정) 막지 않는다', () => {
    expect(isNotEventOrganizer({ myRole: null, attendees: null })).toBe(false)
    expect(isNotEventOrganizer({ myRole: null, attendees: [] })).toBe(false)
    expect(isNotEventOrganizer(undefined)).toBe(false)
  })
})

const ev = (id: number, startsAt: string, endsAt: string, allDay = false): CalendarEvent => ({
  id, title: `e${id}`, description: null, startsAt, endsAt, allDay,
  location: null, color: null, calendarId: 1, calendarName: '기본', effectiveColor: 'blue',
  reminderMinutes: null, recurrenceRule: null, createdAt: startsAt, updatedAt: startsAt,
})

describe('monthMatrix', () => {
  it('일요일 시작 6주(42칸) 그리드를 만든다', () => {
    const cells = monthMatrix(new Date('2026-06-15T00:00:00'))
    expect(cells).toHaveLength(42)
    expect(cells[0].getDay()).toBe(0)
  })
})

describe('weekDays', () => {
  it('해당 주의 7일을 일요일부터 반환', () => {
    const days = weekDays(new Date('2026-06-10T00:00:00'))
    expect(days).toHaveLength(7)
    expect(days[0].getDay()).toBe(0)
  })
})

describe('visibleRange', () => {
  it('month 뷰는 from<to ISO 범위', () => {
    const { from, to } = visibleRange('month', new Date('2026-06-15T00:00:00'))
    expect(new Date(from).getTime()).toBeLessThan(new Date(to).getTime())
  })
})

describe('allDayLocalDate', () => {
  // 종일 두 저장 규약 모두 의도한 캘린더 날짜(로컬 자정)로 복원 — TimeGrid/AgendaView 표시·정렬 공통.
  it('UTC 자정(동기화)과 KST 자정 instant(로컬) 모두 의도 날짜로 복원', () => {
    const synced = allDayLocalDate('2026-06-06T00:00:00Z') // 동기화
    expect([synced.getFullYear(), synced.getMonth() + 1, synced.getDate()]).toEqual([2026, 6, 6])
    const local = allDayLocalDate('2026-07-09T15:00:00Z') // 로컬 KST 7/10
    expect([local.getFullYear(), local.getMonth() + 1, local.getDate()]).toEqual([2026, 7, 10])
  })
})

describe('eventsOnDay', () => {
  it('해당 날짜와 겹치는 일정만 반환', () => {
    const list = [ev(1, '2026-06-10T09:00:00Z', '2026-06-10T10:00:00Z'),
                  ev(2, '2026-06-11T09:00:00Z', '2026-06-11T10:00:00Z')]
    const got = eventsOnDay(list, new Date('2026-06-10T00:00:00'))
    expect(got.map((e) => e.id)).toEqual([1])
  })

  // 종일 일정은 instant 가 아니라 캘린더 날짜로 비교해야 한다. M365 동기화 종일은 UTC 자정
  // [D 00:00Z, D+1 00:00Z) 로 저장되는데, KST 에서 instant 겹침으로 보면 배타적 end(D+1 00:00Z=
  // D+1 09:00 KST)가 D+1 셀에 걸려 양일에 찍힌다(현충일 6/6·6/7 버그).
  it('UTC 자정 종일(동기화)은 시작일에만 찍히고 다음 날엔 안 찍힌다', () => {
    const holiday = ev(1, '2026-06-06T00:00:00Z', '2026-06-07T00:00:00Z', true)
    expect(eventsOnDay([holiday], new Date('2026-06-06T00:00:00')).map((e) => e.id)).toEqual([1])
    expect(eventsOnDay([holiday], new Date('2026-06-07T00:00:00')).map((e) => e.id)).toEqual([])
  })

  // 로컬 생성 종일은 KST 자정 instant(전날 15:00Z)로 저장된다 — 동일하게 해당 날짜에만.
  it('KST 자정 instant 종일(로컬 생성)은 해당 날짜에만 찍힌다', () => {
    const local = ev(2, '2026-07-09T15:00:00Z', '2026-07-10T15:00:00Z', true) // KST 7/10
    expect(eventsOnDay([local], new Date('2026-07-09T00:00:00')).map((e) => e.id)).toEqual([])
    expect(eventsOnDay([local], new Date('2026-07-10T00:00:00')).map((e) => e.id)).toEqual([2])
    expect(eventsOnDay([local], new Date('2026-07-11T00:00:00')).map((e) => e.id)).toEqual([])
  })

  // 다중일 종일은 half-open [start,end) — 마지막 배타적 end 날짜엔 안 찍힌다.
  it('다중일 종일은 half-open 으로 마지막 날 제외', () => {
    const span = ev(3, '2026-06-06T00:00:00Z', '2026-06-08T00:00:00Z', true)
    expect(eventsOnDay([span], new Date('2026-06-06T00:00:00')).map((e) => e.id)).toEqual([3])
    expect(eventsOnDay([span], new Date('2026-06-07T00:00:00')).map((e) => e.id)).toEqual([3])
    expect(eventsOnDay([span], new Date('2026-06-08T00:00:00')).map((e) => e.id)).toEqual([])
  })
})

// ── 사이드바 표시 토글 → 그리드·미니 캘린더 점 (WP-412: 이전 E2E calendar-containers·calendar-sidebar 일부를 대체) ──
describe('isEventVisible', () => {
  const mine = new Set([1])
  const layers: CalendarLayers = { hiddenCalendarIds: [], issueDues: true, invited: true }

  it('내 캘린더 일정은 캘린더별 토글을 따른다', () => {
    expect(isEventVisible(layers, mine, { calendarId: 1 })).toBe(true)
    expect(isEventVisible(toggleCalendar(layers, 1), mine, { calendarId: 1 })).toBe(false)
    // 다시 켜면 복귀
    expect(isEventVisible(toggleCalendar(toggleCalendar(layers, 1), 1), mine, { calendarId: 1 })).toBe(true)
  })

  it('내 캘린더가 아닌(초대받은) 일정은 "초대받은 일정" 토글만 따른다', () => {
    const off = { ...layers, invited: false }
    expect(isEventVisible(layers, mine, { calendarId: 99 })).toBe(true)
    expect(isEventVisible(off, mine, { calendarId: 99 })).toBe(false)
    // 초대 토글을 꺼도 내 일정은 유지
    expect(isEventVisible(off, mine, { calendarId: 1 })).toBe(true)
  })
})

describe('markedDays', () => {
  const june = new Date('2026-06-10T00:00:00')
  const due: IssueDueMarker = { issueId: 7, projectKey: 'P', number: 7, title: 'd', dueDate: '2026-06-11' }
  const meeting = ev(1, '2026-06-11T01:00:00Z', '2026-06-11T02:00:00Z')
  const keys = (days: Date[]) => days.map((d) => `${d.getMonth() + 1}/${d.getDate()}`)

  it('일정·마감이 있는 날에만 점', () => {
    expect(keys(markedDays(june, [meeting], [], true, () => true))).toEqual(['6/11'])
    expect(keys(markedDays(june, [], [due], true, () => true))).toEqual(['6/11'])
  })

  it('표시 토글로 숨긴 캘린더의 일정은 점에서도 빠진다', () => {
    expect(markedDays(june, [meeting], [], true, () => false)).toEqual([])
  })

  it('이슈 마감일 레이어를 끄면 마감 점도 사라진다', () => {
    expect(markedDays(june, [], [due], false, () => true)).toEqual([])
  })
})

describe('providerLabel / groupCalendarsBySource', () => {
  const cal = (id: number, over: Partial<Calendar> = {}): Calendar => ({
    id, name: `c${id}`, color: 'blue', isDefault: false, position: id, isReadOnly: false, ...over,
  })

  it('공급자 raw 문자열을 pill 라벨로(모르는 값은 그대로, 없으면 빈 문자열)', () => {
    expect(providerLabel('M365_GRAPH')).toBe('M365')
    expect(providerLabel('IMAP')).toBe('IMAP')
    expect(providerLabel('GOOGLE')).toBe('GOOGLE')
    expect(providerLabel(null)).toBe('')
  })

  it('로컬과 연동 캘린더를 나누고 계정별로 첫 등장 순서대로 묶는다', () => {
    const acct = { accountEmail: 'a@x.kr', provider: 'M365_GRAPH' }
    const g = groupCalendarsBySource([
      cal(1, { isDefault: true }),
      cal(10, acct),
      cal(2),
      cal(11, { ...acct, isReadOnly: true }),
      cal(20, { accountEmail: 'b@x.kr', provider: 'M365_GRAPH' }),
    ])
    expect(g.local.map((c) => c.id)).toEqual([1, 2])
    expect(g.accounts.map((a) => [a.email, a.provider, a.calendars.map((c) => c.id)])).toEqual([
      ['a@x.kr', 'M365_GRAPH', [10, 11]],
      ['b@x.kr', 'M365_GRAPH', [20]],
    ])
  })
})

describe('isoToLocalInput / proposalTimeRange (KST)', () => {
  it('UTC instant 를 로컬(KST) datetime-local 로 — 오프셋 무시 slice(06시 버그) 금지', () => {
    expect(isoToLocalInput('2026-07-05T06:00:00Z')).toBe('2026-07-05T15:00')
    expect(isoToLocalInput('2026-07-05T06:00:00+00:00')).toBe('2026-07-05T15:00')
    expect(isoToLocalInput(null)).toBe('')
    expect(isoToLocalInput('잘못된값')).toBe('')
  })

  it('제안 카드 읽기전용 시간은 KST 날짜·시각 ~ 종료 시각', () => {
    expect(proposalTimeRange('2026-07-05T06:00:00Z', '2026-07-05T07:00:00Z')).toBe('2026-07-05 15:00 ~ 16:00')
    expect(proposalTimeRange('2026-07-05T06:00:00Z', null)).toBe('2026-07-05 15:00')
  })
})

// WP-539: 시간 그리드 블록은 그날에 걸친 구간만 그린다(슬롯 1시간 = 48px). 시·분만 보면 자정을 넘기는 일정이 두 날 모두 시작 시각
// 위치의 최소 높이 조각으로 그려졌다(11/12 23:00–11/13 01:30 이 12·13일 모두 23시에 16px).
describe('timedEventBox', () => {
  const night = ev(1, '2026-11-12T23:00:00+09:00', '2026-11-13T01:30:00+09:00')
  it('시작한 날은 시작 시각부터 자정까지', () => {
    expect(timedEventBox(night, new Date('2026-11-12T00:00:00'))).toEqual({ top: 23 * 48, height: 48 })
  })
  it('이어지는 날은 0시부터 종료 시각까지', () => {
    expect(timedEventBox(night, new Date('2026-11-13T00:00:00'))).toEqual({ top: 0, height: 1.5 * 48 })
  })
  it('하루를 통째로 덮는 날은 0시부터 24시까지', () => {
    const long = ev(2, '2026-11-12T22:00:00+09:00', '2026-11-14T02:00:00+09:00')
    expect(timedEventBox(long, new Date('2026-11-13T00:00:00'))).toEqual({ top: 0, height: 24 * 48 })
  })
  it('같은 날 일정은 시작·종료 그대로, 아주 짧으면 최소 16px', () => {
    expect(timedEventBox(ev(3, '2026-11-12T10:00:00+09:00', '2026-11-12T11:30:00+09:00'), new Date('2026-11-12T00:00:00')))
      .toEqual({ top: 10 * 48, height: 1.5 * 48 })
    expect(timedEventBox(ev(4, '2026-11-12T10:00:00+09:00', '2026-11-12T10:05:00+09:00'), new Date('2026-11-12T00:00:00')).height)
      .toBe(16)
  })
})
