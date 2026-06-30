import { describe, expect, it } from 'vitest'

import type { CalendarEvent } from '../types/calendar'
import { allDayLocalDate, eventsOnDay,monthMatrix, visibleRange, weekDays } from './calendar'

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
