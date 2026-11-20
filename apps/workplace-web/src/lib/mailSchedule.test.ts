// WP-1787 메일 예약 보내기 — 프리셋(내일·월요일 오전 9시)과 예약 시각 라벨.
import { describe, expect, it } from 'vitest'

import { formatScheduleLabel, maxScheduleDate, minScheduleDate, scheduledRefetchInterval, schedulePresets } from './mailSchedule'

/** 로컬 시각으로 만든다(테스트가 시간대에 의존하지 않게). */
const d = (y: number, m: number, day: number, h = 0, min = 0) => new Date(y, m - 1, day, h, min)

describe('schedulePresets', () => {
  it('목요일 밤 → 내일(금) 9시, 월요일 9시', () => {
    const [a, b] = schedulePresets(d(2026, 11, 19, 22, 30))
    expect(a).toMatchObject({ key: 'tomorrow', label: '내일 오전 9:00', dateLabel: '11월 20일 (금)' })
    expect(a.at).toEqual(d(2026, 11, 20, 9))
    expect(b).toMatchObject({ key: 'monday', label: '월요일 오전 9:00', dateLabel: '11월 23일 (월)' })
    expect(b.at).toEqual(d(2026, 11, 23, 9))
  })

  it('일요일 → 내일이 월요일이라 +7일, 「다음 주」 문구', () => {
    const [a, b] = schedulePresets(d(2026, 11, 22, 10))
    expect(a.at).toEqual(d(2026, 11, 23, 9))
    expect(b.label).toBe('다음 주 월요일 오전 9:00')
    expect(b.at).toEqual(d(2026, 11, 30, 9))
  })

  it('월요일 아침 → 내일 화요일, 월요일은 다음 주 11-30', () => {
    const [a, b] = schedulePresets(d(2026, 11, 23, 8))
    expect(a.at).toEqual(d(2026, 11, 24, 9))
    expect(b.label).toBe('월요일 오전 9:00')
    expect(b.at).toEqual(d(2026, 11, 30, 9))
  })
})

describe('formatScheduleLabel', () => {
  const now = d(2026, 11, 19, 10)
  it.each([
    [d(2026, 11, 19, 15), '오늘 오후 3:00'],
    [d(2026, 11, 20, 9), '내일 오전 9:00'],
    [d(2026, 11, 23, 13, 30), '11월 23일 (월) 오후 1:30'],
    [d(2027, 1, 4, 9, 5), '2027년 1월 4일 (월) 오전 9:05'],
    [d(2026, 11, 19, 12), '오늘 오후 12:00'],
    [d(2026, 11, 19, 0, 10), '오늘 오전 12:10'],
  ])('%s → %s', (at, expected) => {
    expect(formatScheduleLabel(at, now)).toBe(expected)
  })
})

describe('minScheduleDate', () => {
  it('초를 버리고 2분 뒤 — 서버의 「1분 뒤 이후」를 늘 넘긴다', () => {
    expect(minScheduleDate(new Date(2026, 10, 19, 10, 0, 30))).toEqual(d(2026, 11, 19, 10, 2))
  })
})

describe('maxScheduleDate', () => {
  it('초를 버린 분 + 365일', () => {
    expect(maxScheduleDate(new Date(2026, 10, 19, 22, 30, 45)).getTime()).toBe(new Date(2026, 10, 19, 22, 30).getTime() + 365 * 86_400_000)
  })
})

describe('scheduledRefetchInterval', () => {
  const now = Date.UTC(2026, 10, 19, 12, 0)
  const at = (ms: number) => new Date(now + ms).toISOString()

  it('예약이 없으면 받지 않는다', () => {
    expect(scheduledRefetchInterval(null, now)).toBe(false)
    expect(scheduledRefetchInterval(undefined, now)).toBe(false)
  })

  it('가장 이른 예약이 2분 안이거나 지났으면 30초마다', () => {
    expect(scheduledRefetchInterval(at(90_000), now)).toBe(30_000)
    expect(scheduledRefetchInterval(at(120_000), now)).toBe(30_000)
    expect(scheduledRefetchInterval(at(-60_000), now)).toBe(30_000)
  })

  it('그보다 멀면 2분 전이 되는 때에 한 번(최대 30분)', () => {
    expect(scheduledRefetchInterval(at(10 * 60_000), now)).toBe(8 * 60_000)
    expect(scheduledRefetchInterval(at(5 * 86_400_000), now)).toBe(30 * 60_000)
  })
})
