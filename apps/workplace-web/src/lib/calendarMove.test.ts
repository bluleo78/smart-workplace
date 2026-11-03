// 일정 끌어 옮기기(WP-1328) 순수 계산 — 시간 그리드 30분 칸 이동, 월 보기 날짜 이동(시각 유지), 종일 이동, 길이 보존,
// 제자리 = null, 여러 날 일정, 옮길 수 있는지 판정, 저장 바디. vitest TZ = Asia/Seoul(서머타임 없음).
import { describe, expect, it } from 'vitest'

import { calendar, calendarEvent } from '../../e2e/factories/calendar.factory'
import {
  canMoveEvent,
  moveRequestBody,
  moveTimedInGrid,
  moveToDay,
  snappedMinuteDelta,
} from './calendarMove'

// 로컬(KST) 날짜 — 시간 그리드 열·월 칸이 넘기는 값(그날 0시)
const day = (d: string) => new Date(`${d}T00:00:00`)
// 6/10(수) 10:00~11:00 KST
const meeting = calendarEvent({ startsAt: '2026-06-10T01:00:00Z', endsAt: '2026-06-10T02:00:00Z' })

describe('snappedMinuteDelta — 끈 거리(px) → 30분 칸', () => {
  it('칸(24px)의 절반을 넘기면 한 칸, 못 넘기면 0', () => {
    expect(snappedMinuteDelta(0)).toBe(0)
    expect(snappedMinuteDelta(11)).toBe(0)
    expect(snappedMinuteDelta(13)).toBe(30)
    expect(snappedMinuteDelta(48)).toBe(60)
    expect(snappedMinuteDelta(-13)).toBe(-30)
    expect(snappedMinuteDelta(-5)).toBe(0)
  })

  it('위아래로 같은 거리면 같은 칸만큼 움직인다 — 정확히 반 칸(12px)도 양쪽 다 한 칸', () => {
    expect(snappedMinuteDelta(12)).toBe(30)
    expect(snappedMinuteDelta(-12)).toBe(-30)
  })
})

describe('moveTimedInGrid — 주·일 보기 시간 그리드', () => {
  it('아래로 1시간 반(72px) 끌면 11:30~12:30, 길이는 그대로', () => {
    expect(moveTimedInGrid(meeting, day('2026-06-10'), day('2026-06-10'), 72)).toEqual({
      startsAt: '2026-06-10T02:30:00.000Z',
      endsAt: '2026-06-10T03:30:00.000Z',
    })
  })

  it('30분 칸에 맞춰 반올림한다 — 40px(50분) 은 한 시간, 30px(37.5분) 은 30분', () => {
    expect(moveTimedInGrid(meeting, day('2026-06-10'), day('2026-06-10'), 40)?.startsAt).toBe('2026-06-10T02:00:00.000Z')
    expect(moveTimedInGrid(meeting, day('2026-06-10'), day('2026-06-10'), 30)?.startsAt).toBe('2026-06-10T01:30:00.000Z')
  })

  it('옆 요일 열로 옮기면 날짜와 칸이 함께 바뀐다', () => {
    expect(moveTimedInGrid(meeting, day('2026-06-10'), day('2026-06-12'), -48)).toEqual({
      startsAt: '2026-06-12T00:00:00.000Z',
      endsAt: '2026-06-12T01:00:00.000Z',
    })
  })

  it('칸에 안 맞는 시각(10:15~10:40)은 원래 분을 지킨 채 30분씩 움직인다', () => {
    const odd = calendarEvent({ startsAt: '2026-06-10T01:15:00Z', endsAt: '2026-06-10T01:40:00Z' })
    expect(moveTimedInGrid(odd, day('2026-06-10'), day('2026-06-10'), 24)).toEqual({
      startsAt: '2026-06-10T01:45:00.000Z',
      endsAt: '2026-06-10T02:10:00.000Z',
    })
  })

  it('제자리(같은 열, 반 칸 미만)면 null — 저장하지 않는다', () => {
    expect(moveTimedInGrid(meeting, day('2026-06-10'), day('2026-06-10'), 8)).toBeNull()
  })

  it('그날 0:00 보다 위나 23:30 보다 아래로 끌면 그날 안으로 자른다', () => {
    expect(moveTimedInGrid(meeting, day('2026-06-10'), day('2026-06-10'), -48 * 20)?.startsAt).toBe('2026-06-09T15:00:00.000Z')
    expect(moveTimedInGrid(meeting, day('2026-06-10'), day('2026-06-10'), 48 * 20)).toEqual({
      startsAt: '2026-06-10T14:30:00.000Z', // 23:30 KST
      endsAt: '2026-06-10T15:30:00.000Z', // 다음 날 00:30 — 길이 유지
    })
  })

  it('23:30 뒤에서 시작한 일정을 옆 날로만 옮기면 원래 시각을 지킨다 — 23:30 으로 당기지 않는다', () => {
    // 6/10 23:45 ~ 6/11 00:15 KST
    const late = calendarEvent({ startsAt: '2026-06-10T14:45:00Z', endsAt: '2026-06-10T15:15:00Z' })
    expect(moveTimedInGrid(late, day('2026-06-10'), day('2026-06-10'), 8)).toBeNull()
    expect(moveTimedInGrid(late, day('2026-06-10'), day('2026-06-11'), 0)).toEqual({
      startsAt: '2026-06-11T14:45:00.000Z',
      endsAt: '2026-06-11T15:15:00.000Z',
    })
    // 아래로 더 끌어도 원래 시각보다 뒤로는 가지 않는다
    expect(moveTimedInGrid(late, day('2026-06-10'), day('2026-06-11'), 48)?.startsAt).toBe('2026-06-11T14:45:00.000Z')
  })

  it('자정을 넘는 여러 날 일정의 둘째 날 조각을 잡아 하루 옮기면 전체가 하루 옮겨진다', () => {
    // 6/10 22:00 ~ 6/11 02:00 KST
    const overnight = calendarEvent({ startsAt: '2026-06-10T13:00:00Z', endsAt: '2026-06-10T17:00:00Z' })
    expect(moveTimedInGrid(overnight, day('2026-06-11'), day('2026-06-12'), 0)).toEqual({
      startsAt: '2026-06-11T13:00:00.000Z',
      endsAt: '2026-06-11T17:00:00.000Z',
    })
  })
})

describe('moveToDay — 월 보기 칸·종일 줄', () => {
  it('타임드 일정은 날짜만 바뀌고 시각·길이는 그대로', () => {
    expect(moveToDay(meeting, day('2026-06-10'), day('2026-06-15'))).toEqual({
      startsAt: '2026-06-15T01:00:00.000Z',
      endsAt: '2026-06-15T02:00:00.000Z',
    })
  })

  it('종일 하루 일정은 놓은 날 하루로 — 로컬 자정으로 저장(일정 창과 같은 표현)', () => {
    const allDay = calendarEvent({ allDay: true, startsAt: '2026-06-09T15:00:00Z', endsAt: '2026-06-10T15:00:00Z' })
    expect(moveToDay(allDay, day('2026-06-10'), day('2026-06-12'))).toEqual({
      startsAt: '2026-06-11T15:00:00.000Z',
      endsAt: '2026-06-12T15:00:00.000Z',
    })
  })

  it('UTC 자정으로 저장된 동기화 종일 일정도 의도한 날짜 기준으로 옮긴다', () => {
    // 6/10 하루(UTC 자정 표현)
    const synced = calendarEvent({ allDay: true, startsAt: '2026-06-10T00:00:00Z', endsAt: '2026-06-11T00:00:00Z' })
    expect(moveToDay(synced, day('2026-06-10'), day('2026-06-11'))).toEqual({
      startsAt: '2026-06-10T15:00:00.000Z',
      endsAt: '2026-06-11T15:00:00.000Z',
    })
  })

  it('여러 날 종일 일정의 가운데 칸을 잡아 옮기면 잡은 칸 → 놓은 칸 차이만큼, 날 수는 그대로', () => {
    // 6/10~6/12(3일)
    const trip = calendarEvent({ allDay: true, startsAt: '2026-06-09T15:00:00Z', endsAt: '2026-06-12T15:00:00Z' })
    expect(moveToDay(trip, day('2026-06-11'), day('2026-06-18'))).toEqual({
      startsAt: '2026-06-16T15:00:00.000Z', // 6/17
      endsAt: '2026-06-19T15:00:00.000Z', // 6/20(배타적) — 3일
    })
  })

  it('길이 0 으로 저장된 종일 일정은 하루 일정으로 옮긴다', () => {
    const zero = calendarEvent({ allDay: true, startsAt: '2026-06-10T01:30:00Z', endsAt: '2026-06-10T02:00:00Z' })
    expect(moveToDay(zero, day('2026-06-10'), day('2026-06-11'))).toEqual({
      startsAt: '2026-06-10T15:00:00.000Z',
      endsAt: '2026-06-11T15:00:00.000Z',
    })
  })

  it('같은 칸에 놓으면 null', () => {
    expect(moveToDay(meeting, day('2026-06-10'), day('2026-06-10'))).toBeNull()
  })
})

describe('canMoveEvent — 일정 창 편집 가능 판정과 같은 규칙', () => {
  const mine = calendar({ id: 1 })
  const synced = calendar({ id: 2, isReadOnly: true, provider: 'M365_GRAPH' })
  it('내 캘린더 일정은 옮길 수 있다', () => {
    expect(canMoveEvent({ calendarId: 1 }, [mine, synced])).toBe(true)
  })
  it('읽기 전용(M365) 캘린더 일정은 못 옮긴다', () => {
    expect(canMoveEvent({ calendarId: 2 }, [mine, synced])).toBe(false)
  })
  it('내 캘린더가 아닌 초대받은 일정·캘린더 목록 로드 전은 못 옮긴다', () => {
    expect(canMoveEvent({ calendarId: 7 }, [mine, synced])).toBe(false)
    expect(canMoveEvent({ calendarId: 1 }, [])).toBe(false)
  })
})

describe('moveRequestBody — 수정 바디', () => {
  it('목록 일정의 필드를 그대로 싣고 시각만 바꾼다 — 참석자·태그는 싣지 않는다', () => {
    const e = calendarEvent({
      title: '주간 회의',
      description: '안건',
      location: '3층',
      color: 'red',
      reminderMinutes: 10,
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE',
      calendarId: 3,
      tags: [{ id: 5, name: '업무', color: 'blue' }],
    })
    const body = moveRequestBody(e, { startsAt: 'S', endsAt: 'E' })
    expect(body).toEqual({
      title: '주간 회의',
      description: '안건',
      startsAt: 'S',
      endsAt: 'E',
      allDay: false,
      location: '3층',
      color: 'red',
      reminderMinutes: 10,
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE',
      calendarId: 3,
    })
    expect(body).not.toHaveProperty('tagIds')
    expect(body).not.toHaveProperty('attendeeUserIds')
  })
})
