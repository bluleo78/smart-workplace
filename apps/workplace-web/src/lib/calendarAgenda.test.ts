// 모바일 캘린더 일정 목록용 순수 로직(WP-136) — 청크 범위·날짜 묶음·제목 문자열을 고정한다.
// vitest 는 TZ=Asia/Seoul 고정(vitest.config.ts).
import { describe, expect, it } from 'vitest'

import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'

import { agendaChunkRange, type AgendaItem, agendaNowState, agendaTitle, eventDate, groupAgendaDays, headerMonthLabel } from './calendarAgenda'

// 테스트용 일정 — 필요한 필드만 덮어쓴다.
function ev(over: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'startsAt'>): CalendarEvent {
  return {
    title: `일정${over.id}`,
    description: null,
    endsAt: over.startsAt,
    allDay: false,
    location: null,
    color: null,
    calendarId: 1,
    calendarName: '내 캘린더',
    effectiveColor: '#3b82f6',
    reminderMinutes: null,
    recurrenceRule: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function due(issueId: number, dueDate: string, title = `이슈${issueId}`): IssueDueMarker {
  return { issueId, projectKey: 'WP', number: issueId, title, dueDate }
}

describe('agendaChunkRange', () => {
  it('index 0 은 시작일 로컬 자정부터 30일', () => {
    // KST 10/13 15:30 → 시작 = 10/13 00:00 KST(= 10/12 15:00Z), 끝 = 11/12 00:00 KST
    expect(agendaChunkRange(new Date('2026-10-13T06:30:00Z'), 0)).toEqual({
      from: '2026-10-12T15:00:00.000Z',
      to: '2026-11-11T15:00:00.000Z',
    })
  })

  it('index n 은 30*n 일 뒤에서 시작하고 앞 청크의 to 와 이어진다', () => {
    const start = new Date('2026-10-13T06:30:00Z')
    const c0 = agendaChunkRange(start, 0)
    const c1 = agendaChunkRange(start, 1)
    const c2 = agendaChunkRange(start, 2)
    expect(c1.from).toBe(c0.to)
    expect(c2.from).toBe(c1.to)
    expect(c1.to).toBe('2026-12-11T15:00:00.000Z')
  })
})

describe('eventDate', () => {
  it('종일은 UTC 자정 동기화 표현도 의도한 캘린더 날짜(로컬 자정)로 복원한다', () => {
    const d = eventDate(ev({ id: 1, startsAt: '2026-10-14T00:00:00Z', allDay: true }))
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(9)
    expect(d.getDate()).toBe(14)
    expect(d.getHours()).toBe(0)
  })

  it('종일이 아니면 시작 instant 그대로', () => {
    expect(eventDate(ev({ id: 1, startsAt: '2026-10-14T01:00:00Z' })).toISOString()).toBe('2026-10-14T01:00:00.000Z')
  })
})

describe('groupAgendaDays', () => {
  it('날짜 오름차순으로 묶고 key 는 yyyy-MM-dd', () => {
    const days = groupAgendaDays(
      [
        ev({ id: 2, startsAt: '2026-10-15T01:00:00Z' }),
        ev({ id: 1, startsAt: '2026-10-13T01:00:00Z' }),
      ],
      [],
    )
    expect(days.map((d) => d.key)).toEqual(['2026-10-13', '2026-10-15'])
    expect(days[0].day.getDate()).toBe(13)
    expect(days[0].day.getHours()).toBe(0)
  })

  it('같은 날 안에서는 종일 → 이슈 마감 → 시각 순(시작 오름차순)', () => {
    const days = groupAgendaDays(
      [
        ev({ id: 1, title: '오후', startsAt: '2026-10-13T06:00:00Z' }), // 15:00 KST
        ev({ id: 2, title: '오전', startsAt: '2026-10-13T00:30:00Z' }), // 09:30 KST
        ev({ id: 3, title: '종일', startsAt: '2026-10-12T15:00:00Z', allDay: true }), // KST 10/13 종일
      ],
      [due(9, '2026-10-13')],
    )
    expect(days).toHaveLength(1)
    expect(
      days[0].items.map((i) => (i.kind === 'event' ? i.event.id : `due-${i.marker.issueId}`)),
    ).toEqual([3, 'due-9', 2, 1])
  })

  it('동률은 제목 → id 순으로 안정 정렬', () => {
    const days = groupAgendaDays(
      [
        ev({ id: 5, title: '나', startsAt: '2026-10-13T01:00:00Z' }),
        ev({ id: 4, title: '가', startsAt: '2026-10-13T01:00:00Z' }),
        ev({ id: 3, title: '가', startsAt: '2026-10-13T01:00:00Z' }),
      ],
      [],
    )
    expect(days[0].items.map((i) => (i.kind === 'event' ? i.event.id : -1))).toEqual([3, 4, 5])
  })

  it('종일 일정은 복원 날짜(UTC 자정 동기화 표현)로 묶는다 — instant 기준이면 KST 에서 어긋나지 않는지 확인', () => {
    // 2026-10-14T00:00Z = KST 10/14 09:00 → 종일 복원 날짜는 10/14
    const days = groupAgendaDays([ev({ id: 1, startsAt: '2026-10-14T00:00:00Z', allDay: true })], [])
    expect(days.map((d) => d.key)).toEqual(['2026-10-14'])
  })

  it('이슈 마감은 같은 날짜 묶음에 병합되고 마감만 있는 날도 생긴다', () => {
    const days = groupAgendaDays(
      [ev({ id: 1, startsAt: '2026-10-13T01:00:00Z' })],
      [due(7, '2026-10-13'), due(8, '2026-10-20')],
    )
    expect(days.map((d) => d.key)).toEqual(['2026-10-13', '2026-10-20'])
    expect(days[0].items.map((i) => i.kind)).toEqual(['due', 'event'])
    expect(days[1].items).toHaveLength(1)
    expect(days[1].items[0]).toMatchObject({ kind: 'due' })
  })

  it('id + occurrenceDate 가 같은 일정은 한 번만(청크 경계 중복), 반복 occurrence 는 구분', () => {
    const a = ev({ id: 1, startsAt: '2026-10-13T01:00:00Z' })
    const days = groupAgendaDays(
      [
        a,
        { ...a },
        ev({ id: 2, startsAt: '2026-10-13T02:00:00Z', occurrenceDate: '2026-10-13T02:00:00Z' }),
        ev({ id: 2, startsAt: '2026-10-14T02:00:00Z', occurrenceDate: '2026-10-14T02:00:00Z' }),
        ev({ id: 2, startsAt: '2026-10-14T02:00:00Z', occurrenceDate: '2026-10-14T02:00:00Z' }),
      ],
      [due(7, '2026-10-13'), due(7, '2026-10-13')],
    )
    expect(days.map((d) => d.items.length)).toEqual([3, 1])
  })

  it('opts.from 이전 날짜는 제외하고 from 당일은 포함한다(겹침 쿼리로 섞여 오는 시작 전 일정)', () => {
    const days = groupAgendaDays(
      [
        ev({ id: 1, startsAt: '2026-10-12T01:00:00Z' }), // 10/12 → 제외
        ev({ id: 2, startsAt: '2026-10-13T01:00:00Z' }), // 10/13 → 포함
      ],
      [due(7, '2026-10-12'), due(8, '2026-10-13')],
      { from: new Date('2026-10-13T06:30:00Z') }, // KST 10/13 15:30 — 시각이 아니라 날짜 기준
    )
    expect(days.map((d) => d.key)).toEqual(['2026-10-13'])
    expect(days[0].items).toHaveLength(2)
  })

  it('입력이 비면 빈 배열', () => {
    expect(groupAgendaDays([], [])).toEqual([])
  })
})

describe('agendaTitle', () => {
  const today = new Date('2026-10-13T03:00:00Z') // KST 10/13(화)

  it('오늘이면 "오늘 · M월 d일 (E)"', () => {
    expect(agendaTitle(new Date(2026, 9, 13), today)).toBe('오늘 · 10월 13일 (화)')
  })

  it('오늘이 아니면 "M월 d일 (E)"', () => {
    expect(agendaTitle(new Date(2026, 9, 14), today)).toBe('10월 14일 (수)')
    expect(agendaTitle(new Date(2026, 10, 5), today)).toBe('11월 5일 (목)')
  })
})

describe('headerMonthLabel', () => {
  const today = new Date('2026-10-13T03:00:00Z')

  it('같은 해면 "M월"', () => {
    expect(headerMonthLabel(new Date(2026, 9, 1), today)).toBe('10월')
    expect(headerMonthLabel(new Date(2026, 0, 31), today)).toBe('1월')
  })

  it('다른 해면 "yyyy년 M월"', () => {
    expect(headerMonthLabel(new Date(2027, 0, 5), today)).toBe('2027년 1월')
    expect(headerMonthLabel(new Date(2025, 11, 31), today)).toBe('2025년 12월')
  })
})

describe('agendaNowState', () => {
  // 오늘 = KST 10/13, 지금 = 10:00 KST(01:00Z)
  const now = new Date('2026-10-13T01:00:00Z')
  const evItem = (over: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'startsAt'>): AgendaItem => ({
    kind: 'event',
    event: ev(over),
  })
  const allDay = evItem({ id: 1, startsAt: '2026-10-13T00:00:00Z', endsAt: '2026-10-14T00:00:00Z', allDay: true })
  const dueItem: AgendaItem = { kind: 'due', marker: due(9, '2026-10-13') }
  // 08:00–09:00 KST(끝남), 09:30–10:00 KST(지금 막 끝남), 09:30–10:30 KST(진행 중), 14:00–15:00 KST(예정)
  const ended = evItem({ id: 2, startsAt: '2026-10-12T23:00:00Z', endsAt: '2026-10-13T00:00:00Z' })
  const endsNow = evItem({ id: 3, startsAt: '2026-10-13T00:30:00Z', endsAt: '2026-10-13T01:00:00Z' })
  const ongoing = evItem({ id: 4, startsAt: '2026-10-13T00:30:00Z', endsAt: '2026-10-13T01:30:00Z' })
  const later = evItem({ id: 5, startsAt: '2026-10-13T05:00:00Z', endsAt: '2026-10-13T06:00:00Z' })

  it('끝난 시간 지정 일정만 흐리게 하고, 선은 아직 안 끝난 첫 시간 지정 일정 앞에 둔다', () => {
    const r = agendaNowState([allDay, dueItem, ended, endsNow, ongoing, later], now)
    // 종일·마감은 흐리지 않음, endsAt == now 는 끝난 것으로 본다
    expect(r.past).toEqual([false, false, true, true, false, false])
    expect(r.nowIndex).toBe(4)
  })

  it('지금 이후 일정만 있으면 종일·마감 다음(첫 시간 지정 일정 앞)에 선', () => {
    const r = agendaNowState([allDay, dueItem, later], now)
    expect(r.past).toEqual([false, false, false])
    expect(r.nowIndex).toBe(2)
  })

  it('시간 지정 일정이 모두 끝났으면 묶음 끝에 선', () => {
    const r = agendaNowState([allDay, ended, endsNow], now)
    expect(r.nowIndex).toBe(3)
  })

  it('시간 지정 일정이 없으면 선을 그리지 않는다(-1)', () => {
    expect(agendaNowState([allDay, dueItem], now)).toEqual({ nowIndex: -1, past: [false, false] })
  })
})
