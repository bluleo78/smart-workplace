// EventDialog 에서 분리한 일정 폼 로직 단위 테스트(WP-412).
// 이전 E2E(외부 읽기전용·참석자·종일·리마인더·반복 종료일)가 다이얼로그를 띄워 확인하던 판정을 입력→출력으로 고정한다.
import { describe, expect, it } from 'vitest'

import type { Attendee } from '../types/calendar'
import {
  allDayDisplayDates,
  allDayFormRange,
  allDayFormValue,
  allDayRangeFromDates,
  eventEditability,
  eventFormSchema,
  type EventFormValues,
  keepStoredAllDayInstants,
  normalizeAllDayRange,
  restoreTimedRange,
  shouldShowRsvp,
  toEventRequest,
} from './calendarEventForm'

const att = (role: Attendee['role'], userId: number | null, over: Partial<Attendee> = {}): Attendee => ({
  userId,
  username: null,
  name: 'n',
  kind: 'HUMAN',
  role,
  rsvpStatus: 'ACCEPTED',
  invitedByUserId: null,
  externalEmail: null,
  ...over,
})

const LOCAL = { id: 1, isReadOnly: false }
const M365_WRITABLE = { id: 10, isReadOnly: false }
const M365_READONLY = { id: 20, isReadOnly: true }

describe('eventEditability (#501, WP-200)', () => {
  it('다른 사람이 주최한 미팅의 내 동기화 사본은 "주최자만" 사유로 읽기전용·참석자 관리 불가', () => {
    const r = eventEditability({
      isEdit: true,
      calendars: [LOCAL, M365_WRITABLE],
      event: { calendarId: 10, myRole: 'ATTENDEE' },
      detailEvent: { myRole: 'ATTENDEE', attendees: [att('ORGANIZER', 2), att('ATTENDEE', 1)] },
    })
    expect(r).toEqual({
      isReadOnly: true,
      readOnlyLabel: { testId: 'event-organizer-only-label', text: '주최자만 수정할 수 있어요' },
      canManageAttendees: false,
      isInvited: false,
    })
  })

  it('내 캘린더에 없는 초대 일정은 상세 로드 전부터 읽기전용(주최자만)', () => {
    const r = eventEditability({
      isEdit: true,
      calendars: [LOCAL],
      event: { calendarId: 99, myRole: undefined },
      detailEvent: undefined,
    })
    expect(r.isReadOnly).toBe(true)
    expect(r.readOnlyLabel?.testId).toBe('event-organizer-only-label')
    // 캘린더 칸은 「초대받은 일정」으로 보인다(WP-604).
    expect(r.isInvited).toBe(true)
  })

  it('캘린더 목록 로드 전엔 "내 캘린더 아님"으로 잠그지 않는다', () => {
    const r = eventEditability({
      isEdit: true,
      calendars: [],
      event: { calendarId: 99, myRole: 'ORGANIZER' },
      detailEvent: undefined,
    })
    expect(r.isReadOnly).toBe(false)
    expect(r.isInvited).toBe(false)
  })

  it('내가 주최한 동기화 일정은 쓰기 가능 캘린더에서 그대로 수정·참석자 관리 가능', () => {
    const r = eventEditability({
      isEdit: true,
      calendars: [LOCAL, M365_WRITABLE],
      event: { calendarId: 10, myRole: 'ORGANIZER' },
      detailEvent: { myRole: 'ORGANIZER', attendees: [att('ORGANIZER', 1), att('ATTENDEE', 2)] },
    })
    expect(r).toEqual({ isReadOnly: false, readOnlyLabel: null, canManageAttendees: true, isInvited: false })
  })

  it('읽기전용 외부 캘린더 일정은 "동기화됨" 사유', () => {
    const r = eventEditability({
      isEdit: true,
      calendars: [LOCAL, M365_READONLY],
      event: { calendarId: 20, myRole: 'ORGANIZER' },
      detailEvent: { myRole: 'ORGANIZER', attendees: [] },
    })
    expect(r.isReadOnly).toBe(true)
    expect(r.readOnlyLabel).toEqual({ testId: 'event-synced-label', text: 'M365에서 동기화됨' })
    expect(r.canManageAttendees).toBe(false)
  })

  it('생성 모드는 항상 편집 가능이고 참석자 즉시 관리는 없다', () => {
    const r = eventEditability({ isEdit: false, calendars: [M365_READONLY], event: null, detailEvent: undefined })
    expect(r).toEqual({ isReadOnly: false, readOnlyLabel: null, canManageAttendees: false, isInvited: false })
  })
})

describe('shouldShowRsvp (#489, #547)', () => {
  const me = 1
  it('내가 일반 참석자이고 응답 상태가 있으면 노출', () => {
    expect(
      shouldShowRsvp(true, me, {
        attendees: [att('ORGANIZER', 10), att('ATTENDEE', me)],
        myRsvpStatus: 'NEEDS_ACTION',
      }),
    ).toBe(true)
  })
  it('주최자에게는 노출하지 않는다', () => {
    expect(
      shouldShowRsvp(true, me, { attendees: [att('ORGANIZER', me), att('ATTENDEE', 2)], myRsvpStatus: 'ACCEPTED' }),
    ).toBe(false)
  })
  it('외부(external) 일정에는 노출하지 않는다', () => {
    expect(
      shouldShowRsvp(true, me, {
        attendees: [att('ORGANIZER', 10), att('ATTENDEE', me)],
        myRsvpStatus: 'NEEDS_ACTION',
        external: true,
      }),
    ).toBe(false)
  })
  it('AGENT 참석자·응답 상태 없음·생성 모드·비로그인은 노출하지 않는다', () => {
    const ev = { attendees: [att('ATTENDEE', me, { kind: 'AGENT' })], myRsvpStatus: 'NEEDS_ACTION' as const }
    expect(shouldShowRsvp(true, me, ev)).toBe(false)
    expect(shouldShowRsvp(true, me, { attendees: [att('ATTENDEE', me)], myRsvpStatus: null })).toBe(false)
    expect(shouldShowRsvp(false, me, { attendees: [att('ATTENDEE', me)], myRsvpStatus: 'ACCEPTED' })).toBe(false)
    expect(shouldShowRsvp(true, undefined, { attendees: [att('ATTENDEE', me)], myRsvpStatus: 'ACCEPTED' })).toBe(false)
  })
})

describe('normalizeAllDayRange (#575)', () => {
  it('같은 날 시작/종료는 시작일 자정~익일 자정(half-open)으로 민다', () => {
    expect(normalizeAllDayRange('2026-06-10T12:00', '2026-06-10T13:00')).toEqual({
      start: '2026-06-10T00:00',
      end: '2026-06-11T00:00',
    })
  })
  it('월말·연말 경계도 달력 날짜로 넘긴다', () => {
    expect(normalizeAllDayRange('2026-12-31T09:00', '2026-12-31T10:00').end).toBe('2027-01-01T00:00')
  })
  it('여러 날에 걸친 값은 날짜를 유지하고 시각만 자정으로', () => {
    expect(normalizeAllDayRange('2026-06-10T09:00', '2026-06-12T18:00')).toEqual({
      start: '2026-06-10T00:00',
      end: '2026-06-12T00:00',
    })
  })
  it('종료가 비어 있으면 시작일 다음날로', () => {
    expect(normalizeAllDayRange('2026-06-10T09:00', '').end).toBe('2026-06-11T00:00')
  })
})

const base: EventFormValues = {
  title: '스탠드업',
  allDay: false,
  start: '2026-06-10T09:00',
  end: '2026-06-10T10:00',
  location: '  ',
  description: ' 메모 ',
  calendarId: undefined,
  color: null,
  reminderMinutes: 'none',
  recurrenceFreq: 'NONE',
  recurrenceInterval: 1,
  recurrenceEnd: 'none',
  recurrenceUntil: '',
  recurrenceCount: 1,
}

describe('toEventRequest', () => {
  it('잠긴 반복 규칙(폼이 담을 수 없는 규칙)은 폼 값 대신 원래 규칙을 보낸다(WP-708)', () => {
    const opts = { isEdit: true, defaultCalendarId: 1, attendeeUserIds: [] }
    // parseRRule 이 BYDAY 를 버려 폼 값은 「매주」만 남은 상태
    const values = { ...base, recurrenceFreq: 'WEEKLY' as const }
    expect(toEventRequest(values, { ...opts, lockedRecurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' }).recurrenceRule).toBe(
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    )
    expect(toEventRequest(values, { ...opts, lockedRecurrenceRule: null }).recurrenceRule).toBe('FREQ=WEEKLY')
  })

  it('리마인더 선택값은 분 단위 숫자로, "none" 은 null 로', () => {
    const opts = { isEdit: false, defaultCalendarId: 1, attendeeUserIds: [] }
    expect(toEventRequest({ ...base, reminderMinutes: '10' }, opts).reminderMinutes).toBe(10)
    expect(toEventRequest({ ...base, reminderMinutes: '1440' }, opts).reminderMinutes).toBe(1440)
    expect(toEventRequest(base, opts).reminderMinutes).toBeNull()
  })

  it('로컬(KST) 입력을 UTC ISO 로, 빈 장소는 null·설명은 trim, 미선택 캘린더는 기본 캘린더', () => {
    const body = toEventRequest(base, { isEdit: false, defaultCalendarId: 7, attendeeUserIds: [2, 3] })
    expect(body).toMatchObject({
      title: '스탠드업',
      startsAt: '2026-06-10T00:00:00.000Z',
      endsAt: '2026-06-10T01:00:00.000Z',
      location: null,
      description: '메모',
      calendarId: 7,
      recurrenceRule: null,
      attendeeUserIds: [2, 3],
    })
  })

  it('편집 모드에선 참석자 id 를 보내지 않는다(별도 invite/remove API)', () => {
    expect(
      toEventRequest(base, { isEdit: true, defaultCalendarId: 7, attendeeUserIds: [2] }).attendeeUserIds,
    ).toBeUndefined()
  })

  it('반복 종료=날짜까지 → UNTIL 포함 RRULE', () => {
    const body = toEventRequest(
      { ...base, recurrenceFreq: 'WEEKLY', recurrenceEnd: 'until', recurrenceUntil: '2026-06-19' },
      { isEdit: false, defaultCalendarId: 1, attendeeUserIds: [] },
    )
    expect(body.recurrenceRule).toBe('FREQ=WEEKLY;UNTIL=20260619T145959Z')
  })
})

describe('eventFormSchema 반복 종료일 (#114)', () => {
  const weeklyUntil = (until: string) => ({
    ...base,
    start: '2026-06-19T09:00',
    end: '2026-06-19T10:00',
    recurrenceFreq: 'WEEKLY' as const,
    recurrenceEnd: 'until' as const,
    recurrenceUntil: until,
  })

  it('종료 날짜가 시작일과 같으면 허용(1회차 발생)', () => {
    expect(eventFormSchema.safeParse(weeklyUntil('2026-06-19')).success).toBe(true)
  })

  it('종료 날짜가 시작일보다 이전이면 recurrenceUntil 에러', () => {
    const r = eventFormSchema.safeParse(weeklyUntil('2026-06-10'))
    expect(r.success).toBe(false)
    expect(r.error?.issues.find((i) => i.path[0] === 'recurrenceUntil')?.message).toBe(
      '반복 종료 날짜는 시작일 이후여야 합니다',
    )
  })

  // WP-904: 날짜 칸이 내보내는 5자리 연도는 RRULE 조립에서 깨져 저장이 무반응이었다 — 서버와 같은 범위 문구 하나만 낸다.
  it('종료 날짜 연도가 범위 밖이면 범위 문구 하나만 낸다', () => {
    const r = eventFormSchema.safeParse(weeklyUntil('20260-10-23'))
    expect(r.success).toBe(false)
    expect(r.error?.issues.filter((i) => i.path[0] === 'recurrenceUntil').map((i) => i.message)).toEqual([
      '날짜는 1900-01-01 ~ 9999-12-31 사이여야 합니다',
    ])
    expect(eventFormSchema.safeParse(weeklyUntil('9999-12-31')).success).toBe(true)
  })

  it('반복 없음이면 숨겨진 반복 필드 잔존 값으로 막지 않는다', () => {
    expect(
      eventFormSchema.safeParse({ ...base, recurrenceEnd: 'until', recurrenceUntil: '', recurrenceInterval: 0 }).success,
    ).toBe(true)
  })
})

// WP-760: 반복 간격은 서버 상한(999)과 같게 폼에서 먼저 막는다 — 상한이 없어 매일·2147483647 일정 하나가 1년 조회를 약 60초 붙잡았다.
describe('eventFormSchema 반복 간격 상한 (WP-760)', () => {
  it('999 까지 허용, 넘으면 recurrenceInterval 에러', () => {
    const daily = { ...base, recurrenceFreq: 'DAILY' as const }
    expect(eventFormSchema.safeParse({ ...daily, recurrenceInterval: 999 }).success).toBe(true)
    const r = eventFormSchema.safeParse({ ...daily, recurrenceInterval: 1000 })
    expect(r.success).toBe(false)
    expect(r.error?.issues.find((i) => i.path[0] === 'recurrenceInterval')?.message).toBe('간격은 999 이하여야 합니다')
  })
})

// WP-543: 설명은 서버 상한(10000자)과 같게 폼에서 먼저 막는다 — 상한이 없어 2MB 설명이 저장되고 그 달 목록이 2MB 가 됐다.
// WP-905: 횟수도 서버 상한(999)과 같게 폼에서 먼저 막는다 — 21억 넘는 값이 서버에서 「1 이상」으로 잘못 거절됐다.
describe('eventFormSchema 반복 횟수 상한 (WP-905)', () => {
  const countOf = (n: number) => ({ ...base, recurrenceFreq: 'DAILY' as const, recurrenceEnd: 'count' as const, recurrenceCount: n })
  it('999 까지 받고 넘으면 상한 문구', () => {
    expect(eventFormSchema.safeParse(countOf(999)).success).toBe(true)
    for (const n of [1000, 2147483648]) {
      const r = eventFormSchema.safeParse(countOf(n))
      expect(r.error?.issues.find((i) => i.path[0] === 'recurrenceCount')?.message).toBe('횟수는 999 이하여야 합니다')
    }
  })
})

describe('eventFormSchema 설명 길이 (WP-543)', () => {
  it('10000자까지 허용, 넘으면 description 에러', () => {
    expect(eventFormSchema.safeParse({ ...base, description: '가'.repeat(10000) }).success).toBe(true)
    const r = eventFormSchema.safeParse({ ...base, description: '가'.repeat(10001) })
    expect(r.success).toBe(false)
    expect(r.error?.issues.find((i) => i.path[0] === 'description')?.message).toBe(
      '설명은 10000자 이하여야 합니다',
    )
  })
})

// WP-902: 연도를 5자리로 넣으면 Date 로 해석되지 않는다 — 순서가 맞는데도 「종료는 시작보다 뒤여야 합니다」로 오안내하던 것을 원인 안내로 바꾼다.
describe('eventFormSchema 시작·종료 해석 (WP-902)', () => {
  const messageOf = (r: ReturnType<typeof eventFormSchema.safeParse>, field: string) =>
    r.error?.issues.filter((i) => i.path[0] === field).map((i) => i.message)

  it('종료 연도가 5자리면 연도 안내만 나오고 순서 오안내는 없다', () => {
    const r = eventFormSchema.safeParse({ ...base, start: '2026-06-19T09:00', end: '12026-06-19T10:00' })
    expect(r.success).toBe(false)
    expect(messageOf(r, 'end')).toEqual(['날짜와 시각을 올바르게 입력하세요 (연도는 4자리)'])
  })

  it('시작 연도가 5자리면 시작 칸에 연도 안내가 나온다', () => {
    const r = eventFormSchema.safeParse({ ...base, start: '12026-06-19T09:00', end: '2026-06-19T10:00' })
    expect(messageOf(r, 'start')).toEqual(['날짜와 시각을 올바르게 입력하세요 (연도는 4자리)'])
    expect(messageOf(r, 'end')).toEqual([])
  })

  it('둘 다 유효하고 종료가 시작보다 앞서면 기존 순서 안내', () => {
    const r = eventFormSchema.safeParse({ ...base, start: '2026-06-19T10:00', end: '2026-06-19T09:00' })
    expect(messageOf(r, 'end')).toEqual(['종료는 시작보다 뒤여야 합니다'])
  })
})

describe('restoreTimedRange (WP-711)', () => {
  it('종일을 켰다 끄면 체크 전 시각으로 돌아온다', () => {
    const remembered = { start: '2026-10-22T10:00', end: '2026-10-22T11:00' }
    const allDay = normalizeAllDayRange(remembered.start, remembered.end)
    expect(restoreTimedRange(allDay, remembered)).toEqual(remembered)
  })
  it('종일인 동안 날짜를 옮겼으면 옮긴 날짜에 원래 시각·길이로', () => {
    expect(
      restoreTimedRange(
        { start: '2026-10-25T00:00', end: '2026-10-26T00:00' },
        { start: '2026-10-22T10:00', end: '2026-10-22T11:30' },
      ),
    ).toEqual({ start: '2026-10-25T10:00', end: '2026-10-25T11:30' })
  })
  it('자정을 넘는 일정은 길이를 지켜 다음 날로 넘어간다', () => {
    expect(
      restoreTimedRange(
        { start: '2026-12-31T00:00', end: '2027-01-01T00:00' },
        { start: '2026-12-31T23:00', end: '2027-01-01T01:00' },
      ),
    ).toEqual({ start: '2026-12-31T23:00', end: '2027-01-01T01:00' })
  })
})

// WP-1072 — 종일 폼 값(자정 경계 [start, end)) ↔ 날짜 칸(종료는 마지막 날 포함)
describe('allDayDisplayDates / allDayRangeFromDates', () => {
  it('하루 종일(다음 날 0시 끝)은 시작·종료가 같은 날로 보인다', () => {
    expect(allDayDisplayDates('2026-10-28T00:00', '2026-10-29T00:00')).toEqual({ startDate: '2026-10-28', endDate: '2026-10-28' })
  })
  it('여러 날은 배타적 끝의 전날이 종료일이다(달·해 경계 포함)', () => {
    expect(allDayDisplayDates('2026-10-28T00:00', '2026-11-02T00:00')).toEqual({ startDate: '2026-10-28', endDate: '2026-11-01' })
    expect(allDayDisplayDates('2026-12-31T00:00', '2027-01-01T00:00').endDate).toBe('2026-12-31')
  })
  // WP-1090 — 시작일로 고쳐 보이면 오류가 남은 채 같은 날을 다시 고를 수 없었다. 폼 값의 마지막 날을 그대로 보인다.
  it('종료가 시작 이하이면 폼 값 그대로 시작일보다 앞선 날로 보이고, 비었으면 빈 칸', () => {
    expect(allDayDisplayDates('2026-10-28T00:00', '').endDate).toBe('')
    expect(allDayDisplayDates('2026-10-28T00:00', '2026-10-28T00:00').endDate).toBe('2026-10-27')
    expect(allDayDisplayDates('2026-10-28T00:00', '2026-10-26T00:00').endDate).toBe('2026-10-25')
  })
  // WP-1103 — 시작 칸을 비운 사이에도 종료 칸은 마지막 날이어야 한다. 배타적 끝을 보이면 시작을 다시 넣을 때 하루 늘었다.
  it('시작이 비었거나 날짜가 아니어도 종료 칸은 마지막 날이고, 시작을 지웠다 다시 넣어도 끝이 그대로다', () => {
    expect(allDayDisplayDates('', '2026-06-13T00:00')).toEqual({ startDate: '', endDate: '2026-06-12' })
    expect(allDayDisplayDates('20271-06-10T00:00', '2026-06-13T00:00').endDate).toBe('2026-06-12')
    // 칸이 하는 일 그대로: 시작을 비움 → 보이는 종료 칸 값으로 폼 값을 다시 만듦 → 시작을 다시 넣음.
    const cleared = allDayRangeFromDates('', allDayDisplayDates('2026-06-10T00:00', '2026-06-13T00:00').endDate)
    const refilled = allDayRangeFromDates('2026-06-10', allDayDisplayDates(cleared.start, cleared.end).endDate)
    expect(refilled).toEqual({ start: '2026-06-10T00:00', end: '2026-06-13T00:00' })
  })
  it('날짜 칸 → 폼 값: 종료일 다음 날 0시가 끝이다(왕복이 같다)', () => {
    expect(allDayRangeFromDates('2026-10-28', '2026-11-01')).toEqual({ start: '2026-10-28T00:00', end: '2026-11-02T00:00' })
    const r = allDayRangeFromDates('2026-10-28', '2026-10-28')
    expect(allDayDisplayDates(r.start, r.end)).toEqual({ startDate: '2026-10-28', endDate: '2026-10-28' })
  })
  it('빈 칸·연도 5자리는 던지지 않고 그대로 넘겨 스키마가 알린다(WP-902)', () => {
    expect(allDayRangeFromDates('', '2026-10-28')).toEqual({ start: '', end: '2026-10-29T00:00' })
    expect(allDayRangeFromDates('2026-10-28', '')).toEqual({ start: '2026-10-28T00:00', end: '' })
    expect(allDayRangeFromDates('2026-10-28', '20271-06-10').end).toBe('20271-06-10T00:00')
    expect(allDayDisplayDates('2026-06-10T12:00', '20271-06-10T13:00')).toEqual({ startDate: '2026-06-10', endDate: '20271-06-1' })
    const res = eventFormSchema.safeParse({ ...base, allDay: true, ...allDayRangeFromDates('2026-10-28', '') })
    expect(res.success).toBe(false)
  })
  it('종료일이 시작일보다 앞이면 스키마가 종일 문구로 막는다', () => {
    const r = allDayRangeFromDates('2026-10-28', '2026-10-26')
    const res = eventFormSchema.safeParse({ ...base, allDay: true, ...r })
    expect(res.success).toBe(false)
    expect(res.error?.issues.map((i) => i.message)).toContain('종료일은 시작일보다 앞설 수 없습니다')
  })
})

// WP-1072 — 종일 프리필(저장 규약 무관하게 그 날짜 자정)과, 날짜를 고치지 않은 저장은 저장된 시각을 그대로 보내기
describe('allDayFormValue / keepStoredAllDayInstants', () => {
  const synced = { allDay: true, startsAt: '2026-06-11T00:00:00Z', endsAt: '2026-06-13T00:00:00Z' }
  const request = { startsAt: 'LOCAL-START', endsAt: 'LOCAL-END', title: 't' }

  // WP-1090 — 길이 0 으로 저장된 종일은 하루 일정으로 연다(처음부터 오류로 열리지 않게), 그대로 저장해도 서버가 거절하는 길이 0 대신 하루로 고친 값을 보낸다.
  it('길이 0 종일은 하루 일정 폼 값으로 열리고, 그대로 저장하면 하루로 고친 시각을 보낸다', () => {
    const zero = { allDay: true, startsAt: '2026-06-11T00:00:00Z', endsAt: '2026-06-11T00:00:00Z' }
    const range = allDayFormRange(zero)
    expect(range).toEqual({ start: '2026-06-11T00:00', end: '2026-06-12T00:00' })
    expect(keepStoredAllDayInstants(request, { allDay: true, ...range }, zero)).toBe(request)
  })
  it('동기화(UTC 자정) 종일은 그 날짜의 자정 폼 값이 된다', () => {
    expect(allDayFormValue(synced.startsAt)).toBe('2026-06-11T00:00')
    expect(allDayFormValue(synced.endsAt)).toBe('2026-06-13T00:00')
  })
  it('날짜를 고치지 않았으면 저장된 시각을 그대로 보낸다', () => {
    const values = { allDay: true, start: '2026-06-11T00:00', end: '2026-06-13T00:00' }
    expect(keepStoredAllDayInstants(request, values, synced)).toEqual({ ...request, startsAt: synced.startsAt, endsAt: synced.endsAt })
  })
  it('날짜를 고쳤거나 종일을 풀었거나 새 일정이면 폼 값으로 보낸다', () => {
    expect(keepStoredAllDayInstants(request, { allDay: true, start: '2026-06-11T00:00', end: '2026-06-14T00:00' }, synced)).toBe(request)
    expect(keepStoredAllDayInstants(request, { allDay: false, start: '2026-06-11T00:00', end: '2026-06-13T00:00' }, synced)).toBe(request)
    expect(keepStoredAllDayInstants(request, { allDay: true, start: '2026-06-11T00:00', end: '2026-06-13T00:00' }, null)).toBe(request)
  })
})
