// 모바일 캘린더 일정 목록용 순수 로직(WP-136) — 청크 범위·날짜 묶음·제목 문자열을 고정한다.
// vitest 는 TZ=Asia/Seoul 고정(vitest.config.ts).
import { describe, expect, it } from 'vitest'

import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'

import {
  agendaChunkRange,
  type AgendaItem,
  agendaNowState,
  agendaProgress,
  agendaTimeLabels,
  agendaTitle,
  duesWithinLoaded,
  eventDate,
  groupAgendaDays,
  headerMonthLabel,
} from './calendarAgenda'

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

  // 진행 중 일정(WP-136 A1) — from 은 KST 10/13. 시작이 그 전이어도 10/13 까지 이어지면 10/13 묶음 맨 앞에 continued 로 넣는다.
  describe('opts.from 전에 시작해 from 날짜까지 이어지는 일정', () => {
    const from = new Date('2026-10-13T06:30:00Z') // KST 10/13 15:30 — 날짜 기준
    // 어제 22:00 KST 시작 → 오늘 09:00 KST 끝(진행 중 시간 일정)
    const overnight = ev({ id: 1, title: '야간 점검', startsAt: '2026-10-12T13:00:00Z', endsAt: '2026-10-13T00:00:00Z' })
    // 10/11~10/15 종일(동기화 UTC 자정, 끝 배타 10/16)
    const conf = ev({ id: 2, title: '학회', allDay: true, startsAt: '2026-10-11T00:00:00Z', endsAt: '2026-10-16T00:00:00Z' })
    // 끝이 정확히 from 자정 — 시간 일정(어제 22:00 → 오늘 00:00 KST)·종일(10/12 하루, 끝 배타 10/13)
    const endsAtMidnight = ev({ id: 3, startsAt: '2026-10-12T13:00:00Z', endsAt: '2026-10-12T15:00:00Z' })
    const allDayYesterday = ev({ id: 4, allDay: true, startsAt: '2026-10-12T00:00:00Z', endsAt: '2026-10-13T00:00:00Z' })
    // 로컬 생성 종일(현지 자정 instant, KST 10/12~10/13, 끝 배타 10/14 00:00 KST = 10/13 15:00Z)
    const localAllDay = ev({ id: 5, title: '휴가', allDay: true, startsAt: '2026-10-11T15:00:00Z', endsAt: '2026-10-13T15:00:00Z' })
    const todayTimed = ev({ id: 6, startsAt: '2026-10-13T01:00:00Z', endsAt: '2026-10-13T02:00:00Z' })
    const todayAllDay = ev({ id: 7, title: '가을 행사', allDay: true, startsAt: '2026-10-13T00:00:00Z', endsAt: '2026-10-14T00:00:00Z' })

    it('시간 일정·여러 날 종일은 from 묶음에 continued 로 들어가고, 끝이 정확히 from 자정이면 빠진다', () => {
      const days = groupAgendaDays([todayTimed, overnight, conf, endsAtMidnight, allDayYesterday, localAllDay, todayAllDay], [], { from })
      expect(days.map((d) => d.key)).toEqual(['2026-10-13'])
      const items = days[0].items as Extract<AgendaItem, { kind: 'event' }>[]
      // 종일 그룹과 같은 순위(맨 앞, 제목순) → 그다음 그 날 시간 일정
      expect(items.map((it) => it.event.id)).toEqual([7, 1, 2, 5, 6])
      expect(items.map((it) => it.continued ?? false)).toEqual([false, true, true, true, false])
    })

    it('두 번째 청크처럼 from 이후 묶음은 그대로 시작일에만 나온다(중복 없이)', () => {
      const later = ev({ id: 8, allDay: true, startsAt: '2026-10-20T00:00:00Z', endsAt: '2026-10-23T00:00:00Z' })
      const days = groupAgendaDays([conf, later, { ...conf }], [], { from })
      expect(days.map((d) => d.key)).toEqual(['2026-10-13', '2026-10-20'])
      expect(days[0].items).toHaveLength(1)
      expect(days[1].items).toEqual([{ kind: 'event', event: later }])
    })

    it('이어지는 행의 시간 칸 — 종일은 실제 마지막 날, 시간 일정은 그 날 끝나면 "~시각"·아니면 "~날짜"', () => {
      const day = new Date(2026, 9, 13)
      expect(agendaTimeLabels(conf, day)).toEqual({ start: '종일', end: '~10/15' })
      expect(agendaTimeLabels(localAllDay, day)).toEqual({ start: '종일', end: '~10/13' })
      expect(agendaTimeLabels(overnight, day)).toEqual({ start: '10/12', end: '~09:00' })
      const multi = ev({ id: 9, startsAt: '2026-10-12T13:00:00Z', endsAt: '2026-10-15T09:00:00Z' }) // ~10/15 18:00 KST
      expect(agendaTimeLabels(multi, day)).toEqual({ start: '10/12', end: '~10/15' })
      // 어제 22:00 → 내일 00:00 KST — 자정 끝은 오늘의 끝이라 "~24:00"(날짜 "~10/14" 아님)
      const toMidnight = ev({ id: 10, startsAt: '2026-10-12T13:00:00Z', endsAt: '2026-10-13T15:00:00Z' })
      expect(agendaTimeLabels(toMidnight, day)).toEqual({ start: '10/12', end: '~24:00' })
    })

    it('지금 선·흐림 계산에서 빠진다 — 끝난 이어지는 일정도 흐리지 않고 선은 그 날 시간 일정 앞', () => {
      const days = groupAgendaDays([overnight, todayTimed], [], { from })
      // 지금 = 10:30 KST — overnight(09:00 끝)은 끝났지만 continued 라 흐리지 않는다. todayTimed(10:00~11:00)는 진행 중.
      const r = agendaNowState(days[0].items, new Date('2026-10-13T01:30:00Z'))
      expect(r.past).toEqual([false, false])
      expect(r.nowIndex).toBe(1)
      // 그 날 시간 일정이 없으면 선을 긋지 않는다(이어지는 일정만으로는 기준 행이 없다).
      expect(agendaNowState(groupAgendaDays([overnight], [], { from })[0].items, new Date('2026-10-13T01:30:00Z')).nowIndex).toBe(-1)
    })
  })
})

// 시작일 행의 시간 칸(WP-136 CR1·CR8·CR9) — 끝 표시 규칙이 이어지는 행과 같은 헬퍼 하나에서 나온다.
describe('agendaTimeLabels(시작일 행)', () => {
  it('하루짜리 종일은 "종일"만, 여러 날 종일은 시작일 행에도 "~마지막 날"', () => {
    const one = ev({ id: 1, allDay: true, startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-15T00:00:00Z' })
    expect(agendaTimeLabels(one, null)).toEqual({ start: '종일', end: null })
    const three = ev({ id: 2, allDay: true, startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-17T00:00:00Z' })
    expect(agendaTimeLabels(three, null)).toEqual({ start: '종일', end: '~10/16' })
    // 로컬 생성 종일(현지 자정 instant) — KST 10/14~10/15
    const local = ev({ id: 3, allDay: true, startsAt: '2026-10-13T15:00:00Z', endsAt: '2026-10-15T15:00:00Z' })
    expect(agendaTimeLabels(local, null)).toEqual({ start: '종일', end: '~10/15' })
  })

  it('같은 날 끝나는 시간 일정은 끝 시각(범위 기호 없이)', () => {
    const e = ev({ id: 4, startsAt: '2026-10-13T05:00:00Z', endsAt: '2026-10-13T06:30:00Z' }) // 14:00~15:30 KST
    expect(agendaTimeLabels(e, null)).toEqual({ start: '14:00', end: '15:30' })
  })

  it('정확히 다음 날 00:00 에 끝나면 같은 날 일정으로 보고 "24:00"', () => {
    const e = ev({ id: 5, startsAt: '2026-10-13T13:00:00Z', endsAt: '2026-10-13T15:00:00Z' }) // 22:00 → 10/14 00:00 KST
    expect(agendaTimeLabels(e, null)).toEqual({ start: '22:00', end: '24:00' })
  })

  it('다음 날 이후에 끝나면 "~M/d" — 자정 끝은 그 전날이 마지막 날', () => {
    const overnight = ev({ id: 6, startsAt: '2026-10-13T13:00:00Z', endsAt: '2026-10-13T17:00:00Z' }) // 22:00 → 10/14 02:00
    expect(agendaTimeLabels(overnight, null)).toEqual({ start: '22:00', end: '~10/14' })
    const twoNights = ev({ id: 7, startsAt: '2026-10-13T13:00:00Z', endsAt: '2026-10-14T15:00:00Z' }) // 22:00 → 10/15 00:00
    expect(agendaTimeLabels(twoNights, null)).toEqual({ start: '22:00', end: '~10/14' })
  })

  it('길이 0 자정 일정은 전날로 당기지 않는다', () => {
    const zero = ev({ id: 8, startsAt: '2026-10-13T15:00:00Z', endsAt: '2026-10-13T15:00:00Z' }) // 10/14 00:00 KST
    expect(agendaTimeLabels(zero, null)).toEqual({ start: '00:00', end: '00:00' })
  })
})

// 청크 진행 요약(WP-136 CR5·CR7) — 시작일 KST 10/13, 청크 0 = 10/13~11/11, 1 = 11/12~12/11, 2 = 12/12~1/10.
describe('agendaProgress', () => {
  const start = new Date(2026, 9, 13)
  const days = groupAgendaDays(
    [
      ev({ id: 1, startsAt: '2026-10-14T01:00:00Z' }), // 청크 0
      ev({ id: 2, startsAt: '2026-11-20T01:00:00Z' }), // 청크 1
    ],
    [due(9, '2026-11-21')], // 청크 1 — 마감 행은 일정 수에서 뺀다
    { from: start },
  )

  it('앞에서부터 연속 성공한 청크까지만 일정 수에 넣는다(뒤 청크가 성공해도 앞이 비면 거기서 멈춤)', () => {
    expect(agendaProgress(days, start, [true, true], [true, true])).toMatchObject({ loadedChunks: 2, eventCount: 2 })
    expect(agendaProgress(days, start, [true, false], [true, false])).toMatchObject({ loadedChunks: 1, eventCount: 1 })
    expect(agendaProgress(days, start, [false, true], [false, true])).toMatchObject({ loadedChunks: 0, eventCount: 0 })
  })

  it('끝에서 연속된 확정·빈 청크 수 — 행이 있는 청크(마감만 있어도)에서 끊기고, 확정 전 청크는 세지 않는다', () => {
    expect(agendaProgress(days, start, [true, true, true, true], [true, true, true, true]).trailingEmpty).toBe(2)
    expect(agendaProgress(days, start, [true, true, true, true], [true, true, true, false]).trailingEmpty).toBe(0)
    expect(agendaProgress([], start, [true, true, true], [true, true, true]).trailingEmpty).toBe(3)
    const duesOnly = groupAgendaDays([], [due(9, '2026-11-21')], { from: start })
    expect(agendaProgress(duesOnly, start, [true, true, true], [true, true, true]).trailingEmpty).toBe(1)
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

// 이전 E2E mobile/calendar-agenda(회귀 — 불러온 범위 끝 다음 날 마감은 숨긴다)를 대체(WP-412).
describe('duesWithinLoaded', () => {
  const due = (id: number, dueDate: string): IssueDueMarker => ({ issueId: id, projectKey: 'WP', number: id, title: `d${id}`, dueDate })

  it('첫 청크(10/13~, to=11/12 00:00 KST)면 11-11 마감은 남기고 dueTo 포함일 11-12 마감은 숨긴다', () => {
    const { to } = agendaChunkRange(new Date('2026-10-13T09:00:00'), 0)
    expect(duesWithinLoaded([due(11, '2026-11-11'), due(12, '2026-11-12')], to).map((d) => d.issueId)).toEqual([11])
  })

  it('다음 청크까지 불러오면 11-12 마감이 들어온다', () => {
    const { to } = agendaChunkRange(new Date('2026-10-13T09:00:00'), 1)
    expect(duesWithinLoaded([due(12, '2026-11-12')], to).map((d) => d.issueId)).toEqual([12])
  })
})
