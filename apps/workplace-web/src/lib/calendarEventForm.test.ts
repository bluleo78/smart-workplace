// EventDialog 에서 분리한 일정 폼 로직 단위 테스트(WP-412).
// 이전 E2E(외부 읽기전용·참석자·종일·리마인더·반복 종료일)가 다이얼로그를 띄워 확인하던 판정을 입력→출력으로 고정한다.
import { describe, expect, it } from 'vitest'

import type { Attendee } from '../types/calendar'
import {
  eventEditability,
  eventFormSchema,
  type EventFormValues,
  normalizeAllDayRange,
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
  })

  it('캘린더 목록 로드 전엔 "내 캘린더 아님"으로 잠그지 않는다', () => {
    const r = eventEditability({
      isEdit: true,
      calendars: [],
      event: { calendarId: 99, myRole: 'ORGANIZER' },
      detailEvent: undefined,
    })
    expect(r.isReadOnly).toBe(false)
  })

  it('내가 주최한 동기화 일정은 쓰기 가능 캘린더에서 그대로 수정·참석자 관리 가능', () => {
    const r = eventEditability({
      isEdit: true,
      calendars: [LOCAL, M365_WRITABLE],
      event: { calendarId: 10, myRole: 'ORGANIZER' },
      detailEvent: { myRole: 'ORGANIZER', attendees: [att('ORGANIZER', 1), att('ATTENDEE', 2)] },
    })
    expect(r).toEqual({ isReadOnly: false, readOnlyLabel: null, canManageAttendees: true })
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
    expect(r).toEqual({ isReadOnly: false, readOnlyLabel: null, canManageAttendees: false })
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

  it('반복 없음이면 숨겨진 반복 필드 잔존 값으로 막지 않는다', () => {
    expect(
      eventFormSchema.safeParse({ ...base, recurrenceEnd: 'until', recurrenceUntil: '', recurrenceInterval: 0 }).success,
    ).toBe(true)
  })
})

// WP-543: 설명은 서버 상한(10000자)과 같게 폼에서 먼저 막는다 — 상한이 없어 2MB 설명이 저장되고 그 달 목록이 2MB 가 됐다.
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
