// formatDateRangeMonthDay — 모바일 사이클 행(openEnded)·타임라인 아젠다 행(collapseSameDay) 문구 고정(WP-197).
// vitest.config 가 TZ=Asia/Seoul 고정. 날짜 문구는 formatDateMonthDay 결과로 비교해 ICU 차이에 흔들리지 않게 한다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { formatDateMonthDay, formatDateRangeMonthDay } from './formatters'

const S = '2026-08-12'
const E = '2026-08-20'
const s = formatDateMonthDay(S)
const e = formatDateMonthDay(E)

// 「올해」 판정(WP-678)이 실행 시각에 흔들리지 않게 시계를 2026-10-21(KST) 로 고정한다 — 아래 2026 날짜는 「올해」다.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-21T03:00:00Z'))
})
afterAll(() => vi.useRealTimers())

describe('formatDateRangeMonthDay', () => {
  it('기본(아젠다식) — 둘 다/시작만/끝만/없음', () => {
    expect(formatDateRangeMonthDay(S, E, '일정 미정')).toBe(`${s} ~ ${e}`)
    expect(formatDateRangeMonthDay(S, null, '일정 미정')).toBe(s)
    expect(formatDateRangeMonthDay(null, E, '일정 미정')).toBe(e)
    expect(formatDateRangeMonthDay(null, undefined, '일정 미정')).toBe('일정 미정')
  })

  it('openEnded(사이클식) — 한쪽만 있으면 열린 범위', () => {
    const o = { openEnded: true }
    expect(formatDateRangeMonthDay(S, E, '—', o)).toBe(`${s} ~ ${e}`)
    expect(formatDateRangeMonthDay(S, null, '—', o)).toBe(`${s} ~`)
    expect(formatDateRangeMonthDay(null, E, '—', o)).toBe(`~ ${e}`)
    expect(formatDateRangeMonthDay(null, null, '—', o)).toBe('—')
  })

  it('collapseSameDay — 켜면 같은 날을 한 날짜로, 끄면 범위 그대로', () => {
    expect(formatDateRangeMonthDay(S, S, '', { collapseSameDay: true })).toBe(s)
    expect(formatDateRangeMonthDay(S, S, '')).toBe(`${s} ~ ${s}`)
    expect(formatDateRangeMonthDay(S, E, '', { collapseSameDay: true })).toBe(`${s} ~ ${e}`)
  })

  it('문구 형태 — 「N월 N일」', () => {
    expect(s).toBe('8월 12일')
  })

  // WP-678: 올해가 아닌 날짜는 연도까지(마일스톤 목록 WP-616 과 같은 규칙) — 해를 넘는 기간이 같은 해 일정처럼 읽혔다.
  describe('올해가 아닌 날짜는 연도까지', () => {
    const now = new Date('2026-10-21T03:00:00Z') // KST 2026-10-21
    it('올해 안의 범위는 월·일만', () => {
      expect(formatDateRangeMonthDay('2026-01-01', '2026-06-30', '', { now })).toBe('1월 1일 ~ 6월 30일')
    })
    it('해를 넘는 범위는 올해가 아닌 쪽에 연도', () => {
      expect(formatDateRangeMonthDay('2026-12-01', '2027-01-05', '', { now })).toBe('12월 1일 ~ 2027년 1월 5일')
      expect(formatDateRangeMonthDay('2025-11-01', '2026-06-30', '', { now })).toBe('2025년 11월 1일 ~ 6월 30일')
    })
    it('다른 해 안의 범위는 양쪽 다 연도', () => {
      expect(formatDateRangeMonthDay('2027-01-01', '2027-06-30', '', { now })).toBe('2027년 1월 1일 ~ 2027년 6월 30일')
    })
    it('한쪽만·같은 날도 같은 규칙', () => {
      expect(formatDateRangeMonthDay('2027-03-02', null, '', { now, openEnded: true })).toBe('2027년 3월 2일 ~')
      expect(formatDateRangeMonthDay('2027-03-02', '2027-03-02', '', { now, collapseSameDay: true })).toBe('2027년 3월 2일')
    })
  })
})
