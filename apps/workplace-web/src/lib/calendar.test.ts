import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memoryStorage } from '@/test/memoryStorage'

import type { Attendee, Calendar, CalendarEvent, IssueDueMarker } from '../types/calendar'
import {
  allDayLocalDate,
  type CalendarLayers,
  dragSlotRange,
  eventCalendarLabel,
  eventDisplayColor,
  eventsOnDay,
  extraTagColors,
  groupCalendarsBySource,
  isEventVisible,
  isLocalRangeReversed,
  isNotEventOrganizer,
  isoToLocalInput,
  layoutTimedEvents,
  loadLastView,
  markedDays,
  monthMatrix,
  proposalTimeRange,
  providerLabel,
  saveLastView,
  timedEventBox,
  timedEventColumnStyle,
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

  // WP-1172: API·AI 제안으로 자정이 아닌 시각(KST 11/6 10:30~11:00)에 저장된 종일은 날짜로 바꾸면 시작=종료라 어느 칸에도 없었다 —
  // 월·주 보기 종일 줄·미니 달력이 모두 이 함수를 쓴다. 시작 날 하루 일정으로 보인다.
  it('자정이 아닌 같은 날 시각으로 저장된 종일은 시작 날에만 찍힌다', () => {
    const midday = ev(4, '2026-11-06T01:30:00Z', '2026-11-06T02:00:00Z', true)
    expect(eventsOnDay([midday], new Date('2026-11-05T00:00:00')).map((e) => e.id)).toEqual([])
    expect(eventsOnDay([midday], new Date('2026-11-06T00:00:00')).map((e) => e.id)).toEqual([4])
    expect(eventsOnDay([midday], new Date('2026-11-07T00:00:00')).map((e) => e.id)).toEqual([])
  })

  it('길이 0 으로 저장된 종일(종료 = 시작)도 그날에 찍힌다', () => {
    const zero = ev(5, '2026-11-05T15:00:00Z', '2026-11-05T15:00:00Z', true) // KST 11/6 자정
    expect(eventsOnDay([zero], new Date('2026-11-06T00:00:00')).map((e) => e.id)).toEqual([5])
    expect(eventsOnDay([zero], new Date('2026-11-07T00:00:00')).map((e) => e.id)).toEqual([])
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

  // WP-1120: 끝나는 날이 다르면 종료 시각만 붙여 이틀 일정이 두 시간짜리로 보였다.
  it('끝나는 날이 다르면 종료에 날짜를 붙이고, 해가 다르면 해까지 붙인다', () => {
    expect(proposalTimeRange('2026-11-06T01:00:00Z', '2026-11-07T03:00:00Z')).toBe('2026-11-06 10:00 ~ 11-07 12:00')
    expect(proposalTimeRange('2026-11-05T16:00:00Z', '2026-11-05T17:00:00Z')).toBe('2026-11-06 01:00 ~ 02:00')
    expect(proposalTimeRange('2026-12-31T14:00:00Z', '2027-01-01T01:00:00Z')).toBe('2026-12-31 23:00 ~ 2027-01-01 10:00')
  })

  it('끝은 배타적 — 다음 날 0시에 끝나면 같은 날 24:00', () => {
    expect(proposalTimeRange('2026-11-06T06:00:00Z', '2026-11-06T15:00:00Z')).toBe('2026-11-06 15:00 ~ 24:00')
  })

  it('읽을 수 없는 시작은 빈 문자열, 읽을 수 없는 종료는 없는 것으로 — 던지지 않는다', () => {
    expect(proposalTimeRange('잘못된값', '2026-11-06T15:00:00Z')).toBe('')
    expect(proposalTimeRange('잘못된값', '2026-11-06T15:00:00Z', true)).toBe('')
    expect(proposalTimeRange('2026-11-06T01:00:00Z', '잘못된값')).toBe('2026-11-06 10:00')
    expect(proposalTimeRange('2026-11-04T00:00:00Z', '잘못된값', true)).toBe('2026-11-04 (종일)')
  })

  // WP-1120: 종일 일정이 「00:00 ~ 00:00」(KST 는 09:00 ~ 09:00)으로 길이 0 인 일정처럼 보였다.
  it('종일은 시각 없이 날짜와 (종일) — 종료는 배타적이라 하루를 빼고, UTC·현지 자정 저장 모두 같은 날짜', () => {
    expect(proposalTimeRange('2026-11-04T00:00:00Z', '2026-11-05T00:00:00Z', true)).toBe('2026-11-04 (종일)')
    expect(proposalTimeRange('2026-11-03T15:00:00Z', '2026-11-04T15:00:00Z', true)).toBe('2026-11-04 (종일)')
    expect(proposalTimeRange('2026-11-04T00:00:00Z', null, true)).toBe('2026-11-04 (종일)')
    expect(proposalTimeRange('2026-11-04T00:00:00Z', '2026-11-06T00:00:00Z', true)).toBe('2026-11-04 ~ 11-05 (종일)')
    expect(proposalTimeRange('2026-12-31T00:00:00Z', '2027-01-02T00:00:00Z', true)).toBe('2026-12-31 ~ 2027-01-01 (종일)')
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

describe('eventCalendarLabel (WP-604)', () => {
  const mine = new Set([1, 2])
  it('내 캘린더 일정은 그 캘린더 이름', () => {
    expect(eventCalendarLabel({ calendarId: 2, calendarName: '팀 일정' }, mine)).toBe('팀 일정')
  })
  it('다른 사람 캘린더(초대받은) 일정은 주최자 캘린더 이름 대신 「초대받은 일정」', () => {
    expect(eventCalendarLabel({ calendarId: 99, calendarName: '기본' }, mine)).toBe('초대받은 일정')
  })
  it('내 캘린더 목록을 아직 못 받았으면 이름을 비운다(주최자 캘린더 이름이 잠깐 비치지 않게)', () => {
    expect(eventCalendarLabel({ calendarId: 99, calendarName: '기본' }, null)).toBeNull()
  })
  it('내 캘린더가 하나도 없으면 보이는 일정은 모두 초대받은 일정', () => {
    expect(eventCalendarLabel({ calendarId: 99, calendarName: '기본' }, new Set())).toBe('초대받은 일정')
  })
})

describe('isLocalRangeReversed (WP-727)', () => {
  it('종료가 시작보다 앞서거나 같으면 true', () => {
    expect(isLocalRangeReversed('2026-07-05T15:00', '2026-07-05T14:30')).toBe(true)
    expect(isLocalRangeReversed('2026-07-05T15:00', '2026-07-05T15:00')).toBe(true)
    expect(isLocalRangeReversed('2026-07-05T23:00', '2026-07-04T23:30')).toBe(true)
  })
  it('종료가 뒤이거나 한쪽이 비면 false', () => {
    expect(isLocalRangeReversed('2026-07-05T15:00', '2026-07-05T16:00')).toBe(false)
    expect(isLocalRangeReversed('', '2026-07-05T16:00')).toBe(false)
    expect(isLocalRangeReversed('2026-07-05T15:00', '')).toBe(false)
  })
})

describe('dragSlotRange — 시간 그리드 끌기 구간(WP-949)', () => {
  const day = new Date(2026, 5, 10)
  const at = (h: number, m: number) => new Date(2026, 5, 10, h, m).getTime()
  // 한 시간 = 48px, 30분 칸 = 24px
  it('두 점이 든 30분 칸을 모두 덮는다(시작 내림·종료 올림)', () => {
    const r = dragSlotRange(day, 10 * 48 + 4, 11 * 48 + 20)
    expect([r.start.getTime(), r.end.getTime()]).toEqual([at(10, 0), at(11, 30)])
  })
  it('위로 끌어도 같은 구간이다', () => {
    const r = dragSlotRange(day, 11 * 48 + 20, 10 * 48 + 4)
    expect([r.start.getTime(), r.end.getTime()]).toEqual([at(10, 0), at(11, 30)])
  })
  it('같은 칸 안이면 30분 한 칸', () => {
    const r = dragSlotRange(day, 9 * 48 + 25, 9 * 48 + 40)
    expect([r.start.getTime(), r.end.getTime()]).toEqual([at(9, 30), at(10, 0)])
  })
  it('열 밖으로 끌면 그날 0시~24시 안으로 자른다', () => {
    const r = dragSlotRange(day, -50, 30 * 48)
    expect(r.start.getTime()).toBe(at(0, 0))
    expect(r.end.getTime()).toBe(new Date(2026, 5, 11).getTime())
  })
})

describe('eventDisplayColor·extraTagColors — 태그 색으로 일정 칠하기(WP-952)', () => {
  const tag = (id: number, color: string) => ({ id, name: `t${id}`, color })
  it('직접 고른 색이 있으면 그 색(서버 effectiveColor), 태그보다 먼저', () => {
    expect(eventDisplayColor({ color: 'red', effectiveColor: 'red', tags: [tag(1, 'amber')] })).toBe('red')
  })
  it('직접 고른 색이 없으면 첫 태그 색', () => {
    expect(eventDisplayColor({ color: null, effectiveColor: 'blue', tags: [tag(1, 'amber'), tag(2, 'violet')] })).toBe('amber')
  })
  it('태그도 없으면 캘린더 색(effectiveColor)', () => {
    expect(eventDisplayColor({ color: null, effectiveColor: 'green', tags: [] })).toBe('green')
    expect(eventDisplayColor({ color: null, effectiveColor: 'green' })).toBe('green')
  })
  it('남은 태그 색은 블록 색과 겹치지 않게 한 번씩', () => {
    expect(
      extraTagColors({ color: null, effectiveColor: 'blue', tags: [tag(1, 'amber'), tag(2, 'violet'), tag(3, 'amber'), tag(4, 'violet')] }),
    ).toEqual(['violet'])
    expect(extraTagColors({ color: null, effectiveColor: 'blue', tags: [tag(1, 'amber')] })).toEqual([])
  })
})

// 캘린더 마지막 보기 기억(WP-948) — 다시 들어오면 마지막으로 쓴 보기로 연다. 사용자·워크스페이스·화면 종류별로 따로 둔다.
const lastViewOwner = { userId: 1, tenantId: 10 }

describe('loadLastView / saveLastView', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('저장한 적이 없으면 null(기본 보기를 쓴다)', () => {
    expect(loadLastView(lastViewOwner, false)).toBeNull()
  })

  it('저장한 보기를 그대로 돌려준다', () => {
    saveLastView(lastViewOwner, false, 'week')
    expect(loadLastView(lastViewOwner, false)).toBe('week')
    saveLastView(lastViewOwner, false, 'day')
    expect(loadLastView(lastViewOwner, false)).toBe('day')
  })

  it('데스크톱과 모바일은 따로 기억한다', () => {
    saveLastView(lastViewOwner, true, 'agenda')
    expect(loadLastView(lastViewOwner, false)).toBeNull()
    saveLastView(lastViewOwner, false, 'week')
    expect(loadLastView(lastViewOwner, true)).toBe('agenda')
  })

  it('다른 사용자·워크스페이스에는 보이지 않는다', () => {
    saveLastView(lastViewOwner, false, 'week')
    expect(loadLastView({ userId: 2, tenantId: 10 }, false)).toBeNull()
    expect(loadLastView({ userId: 1, tenantId: 11 }, false)).toBeNull()
  })

  it('알 수 없는 값은 무시한다', () => {
    localStorage.setItem('calendar.lastView.desktop:1:10', 'year')
    expect(loadLastView(lastViewOwner, false)).toBeNull()
    localStorage.setItem('calendar.lastView.desktop:1:10', 'toString')
    expect(loadLastView(lastViewOwner, false)).toBeNull()
  })

  it('저장소에 접근할 수 없어도 던지지 않는다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    expect(() => saveLastView(lastViewOwner, false, 'week')).not.toThrow()
    expect(loadLastView(lastViewOwner, false)).toBeNull()
  })
})

// WP-1138: 겹치는 일정이 같은 자리·폭으로 포개져 뒤 일정이 앞 일정을 덮었다 — 겹침 묶음마다 열을 나눈다.
describe('layoutTimedEvents', () => {
  const day = new Date('2026-10-29T00:00:00')
  const at = (id: number, s: string, e: string) => ev(id, `2026-10-29T${s}:00+09:00`, `2026-10-29T${e}:00+09:00`)
  const lanesOf = (events: CalendarEvent[]) =>
    Object.fromEntries(layoutTimedEvents(events, day).map((l) => [l.event.id, [l.lane, l.lanes]]))

  it('서로 겹치는 세 일정은 세 열로 나뉜다(이슈 재현: 01:00–02:00, 01:15–03:00, 01:30–02:30)', () => {
    expect(lanesOf([at(5, '01:00', '02:00'), at(7, '01:15', '03:00'), at(6, '01:30', '02:30')])).toEqual({
      5: [0, 3],
      7: [1, 3],
      6: [2, 3],
    })
  })

  it('겹치지 않는 일정은 각자 전체 폭(한 열)이다', () => {
    expect(lanesOf([at(1, '09:00', '10:00'), at(2, '10:00', '11:00')])).toEqual({ 1: [0, 1], 2: [0, 1] })
  })

  it('먼저 끝난 열은 다시 쓴다 — A·B 가 겹치고 C 는 A 가 끝난 뒤 B 와만 겹치면 두 열', () => {
    expect(lanesOf([at(1, '09:00', '10:00'), at(2, '09:30', '11:00'), at(3, '10:00', '10:30')])).toEqual({
      1: [0, 2],
      2: [1, 2],
      3: [0, 2],
    })
  })

  it('같은 시각에 시작하면 긴 일정이 왼쪽 열이다', () => {
    expect(lanesOf([at(1, '09:00', '09:30'), at(2, '09:00', '11:00')])).toEqual({ 1: [1, 2], 2: [0, 2] })
  })

  it('묶음마다 열 수를 따로 센다 — 오전의 세 겹침이 오후 단독 일정의 폭을 줄이지 않는다', () => {
    const layout = lanesOf([at(1, '09:00', '10:00'), at(2, '09:00', '10:00'), at(3, '09:00', '10:00'), at(4, '15:00', '16:00')])
    expect(layout[4]).toEqual([0, 1])
    expect(layout[1][1]).toBe(3)
  })

  it('분 단위 경계에서 맞닿은 일정은 겹치지 않는다(01:10 의 px 가 소수여도)', () => {
    expect(lanesOf([at(1, '00:05', '01:10'), at(2, '01:10', '02:00')])).toEqual({ 1: [0, 1], 2: [0, 1] })
    // 끝난 열도 같은 기준으로 다시 쓴다 — 셋째 열을 만들지 않는다.
    expect(lanesOf([at(1, '08:05', '09:10'), at(2, '08:30', '10:00'), at(3, '09:10', '09:40')])).toEqual({
      1: [0, 2],
      2: [1, 2],
      3: [0, 2],
    })
  })

  it('아주 짧은 일정은 그려지는 최소 높이(16px)로 겹침을 본다', () => {
    // 09:00–09:05 는 16px(20분 높이)로 그려져 09:10 에 시작하는 일정과 화면에서 겹친다.
    expect(lanesOf([at(1, '09:00', '09:05'), at(2, '09:10', '10:00')])).toEqual({ 1: [0, 2], 2: [1, 2] })
  })

  it('위치·높이는 timedEventBox 와 같다', () => {
    const e = at(1, '10:00', '11:30')
    const [l] = layoutTimedEvents([e], day)
    expect({ top: l.top, height: l.height }).toEqual(timedEventBox(e, day))
  })

  it('위치·높이는 겹침 판정과 같은 정수 px 다 — 겹치지 않는다고 본 두 블록이 1px 미만 포개지지 않는다(WP-1154)', () => {
    const [a, b] = layoutTimedEvents([at(1, '00:05', '01:10'), at(2, '01:10', '02:00')], day)
    for (const l of [a, b]) {
      expect(Number.isInteger(l.top)).toBe(true)
      expect(Number.isInteger(l.height)).toBe(true)
    }
    expect(a.top + a.height).toBeLessThanOrEqual(b.top)
  })

  const spansOf = (events: CalendarEvent[]) =>
    Object.fromEntries(layoutTimedEvents(events, day).map((l) => [l.event.id, l.span]))

  it('오른쪽 열들이 그 시간에 비어 있으면 짧은 일정을 넓힌다 — 셋이 겹친 뒤 하나만 남은 시간의 일정은 두 열(WP-1154)', () => {
    // 1: 09–12(0열), 2·3: 09–10(1·2열), 4: 11–12 는 1열에 들어가고 2열도 그 시간에 비어 있다.
    const events = [at(1, '09:00', '12:00'), at(2, '09:00', '10:00'), at(3, '09:00', '10:00'), at(4, '11:00', '12:00')]
    expect(lanesOf(events)[4]).toEqual([1, 3])
    expect(spansOf(events)).toEqual({ 1: 1, 2: 1, 3: 1, 4: 2 })
  })

  it('오른쪽에서 처음 막히는 열에서 멈춘다 — 그 너머 빈 열까지 건너 넓히지 않는다', () => {
    // 1: 08:00–10(0열), 2: 08:30–12(1열), 3: 08:45–10(2열), 4: 10–11 은 0열에 들어가 바로 오른쪽 1열(2번)에 막힌다 — 2열은 비어도 넓히지 않는다.
    const events = [at(1, '08:00', '10:00'), at(2, '08:30', '12:00'), at(3, '08:45', '10:00'), at(4, '10:00', '11:00')]
    expect(lanesOf(events)[4]).toEqual([0, 3])
    expect(spansOf(events)[4]).toBe(1)
  })

  it('겹치지 않는 일정과 나란한 일정은 한 열만 차지한다', () => {
    expect(spansOf([at(1, '09:00', '10:00')])).toEqual({ 1: 1 })
    expect(spansOf([at(1, '09:00', '10:00'), at(2, '09:30', '10:30')])).toEqual({ 1: 1, 2: 1 })
  })
})

describe('timedEventColumnStyle', () => {
  // CSS calc 를 칸 폭(px)으로 풀어 블록의 왼쪽·오른쪽 끝을 구한다 — 넘침 판정을 숫자로 본다.
  const resolve = (expr: string, column: number) =>
    Function(
      'return ' +
        expr
          .replace(/calc|max|min/g, (m) => (m === 'calc' ? '' : `Math.${m}`))
          .replace(/100%/g, String(column))
          .replace(/px/g, ''),
    )() as number
  const edges = (lane: number, span: number, lanes: number, column: number) => {
    const { left, width } = timedEventColumnStyle(lane, span, lanes)
    const l = resolve(left, column)
    return { left: l, right: l + resolve(width, column), width: resolve(width, column) }
  }

  it('한 열이면 칸 양옆 2px 안쪽 전체 폭이다', () => {
    expect(edges(0, 1, 1, 200)).toEqual({ left: 2, right: 198, width: 196 })
  })

  it('좁은 칸(44px)에 10개가 겹쳐도 마지막 블록이 칸 밖으로 넘치지 않고 폭도 0 이 되지 않는다(WP-1154)', () => {
    for (let lane = 0; lane < 10; lane++) {
      const e = edges(lane, 1, 10, 44)
      expect(e.right).toBeLessThanOrEqual(44 - 2)
      expect(e.width).toBeGreaterThan(0)
    }
  })

  it('좁은 칸에서도 블록 폭은 최소 4px(열 몫이 더 작으면 열 몫 전부)이고, 안쪽 여백이 폭을 넘지 않는다', () => {
    // 44px 칸 12열 → 열 몫 40/12 ≈ 3.33px: 틈 없이 열 몫 전부. 200px 칸 12열 → 열 몫 16.3px: 2px 틈.
    expect(edges(0, 1, 12, 44).width).toBeCloseTo(40 / 12)
    expect(edges(0, 1, 12, 200).width).toBeCloseTo(196 / 12 - 2)
    expect(edges(0, 1, 40, 200).width).toBe(4) // 열 몫 4.9px — 틈 2px 를 빼면 2.9px 라 4px 로 올린다
    for (const [lanes, column] of [[12, 44], [3, 200], [1, 200]]) {
      const { paddingInline } = timedEventColumnStyle(0, 1, lanes)
      const pad = resolve(paddingInline, column)
      expect(pad).toBeLessThanOrEqual(4)
      expect(pad * 2).toBeLessThanOrEqual(edges(0, 1, lanes, column).width + 1e-9)
    }
  })

  it('나란한 블록은 서로 겹치지 않는다 — 앞 블록의 오른쪽 끝이 다음 블록의 왼쪽 끝을 넘지 않는다', () => {
    for (const column of [44, 200]) {
      for (let lane = 0; lane < 9; lane++) {
        expect(edges(lane, 1, 10, column).right).toBeLessThanOrEqual(edges(lane + 1, 1, 10, column).left + 1e-9)
      }
    }
  })

  it('span 만큼 열을 차지한다 — 1열부터 두 열이면 오른쪽 끝까지', () => {
    const e = edges(1, 2, 3, 302)
    expect(e.left).toBeCloseTo(2 + 298 / 3)
    expect(e.right).toBeCloseTo(300)
  })
})
