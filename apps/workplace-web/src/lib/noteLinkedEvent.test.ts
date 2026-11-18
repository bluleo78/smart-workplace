// 노트 연결 일정 표시 문구·주소 단위 테스트(WP-1703). vitest 는 TZ=Asia/Seoul 로 고정돼 로컬 시각 = KST.
import { describe, expect, it } from 'vitest'

import { linkedEventHref, linkedEventMeta } from './noteLinkedEvent'

const NOW = new Date('2026-11-18T03:00:00Z')
const timed = { startsAt: '2026-11-18T01:00:00Z', allDay: false, attendeeCount: 5 }

describe('linkedEventMeta', () => {
  it('시간 일정은 날짜·오전/오후 시각과 참석 인원을 붙인다', () => {
    expect(linkedEventMeta(timed, NOW)).toBe('11월 18일 (수) 오전 10:00 · 참석 5명')
  })
  it('참석자가 0명이면 인원 문구를 생략한다', () => {
    expect(linkedEventMeta({ ...timed, attendeeCount: 0 }, NOW)).toBe('11월 18일 (수) 오전 10:00')
  })
  it('종일 일정은 시각 대신 「종일」', () => {
    // KST 자정 시작 = 전날 15:00Z
    expect(linkedEventMeta({ startsAt: '2026-11-17T15:00:00Z', allDay: true, attendeeCount: 0 }, NOW)).toBe('11월 18일 (수) 종일')
  })
})

describe('linkedEventHref', () => {
  it('단일 일정은 eventId 만', () => {
    expect(linkedEventHref({ eventId: 7, occurrenceDate: null, overrideEventId: null })).toBe('/calendar?eventId=7')
  })
  it('반복 회차는 occurrence 를 인코딩해 붙인다', () => {
    expect(linkedEventHref({ eventId: 7, occurrenceDate: '2026-11-25T01:00:00Z', overrideEventId: null })).toBe(
      '/calendar?eventId=7&occurrence=2026-11-25T01%3A00%3A00Z',
    )
  })
  it('「이 회차만」 옮긴 회차는 override id 로 열고 occurrence 를 붙이지 않는다(WP-1703)', () => {
    expect(linkedEventHref({ eventId: 7, occurrenceDate: '2026-11-25T01:00:00Z', overrideEventId: 42 })).toBe(
      '/calendar?eventId=42',
    )
  })
})
