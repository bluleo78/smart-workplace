// formatDateRangeMonthDay — 모바일 사이클 행(openEnded)·타임라인 아젠다 행(collapseSameDay) 문구 고정(WP-197).
// vitest.config 가 TZ=Asia/Seoul 고정. 날짜 문구는 formatDateMonthDay 결과로 비교해 ICU 차이에 흔들리지 않게 한다.
import { describe, expect, it } from 'vitest'

import { formatDateMonthDay, formatDateRangeMonthDay } from './formatters'

const S = '2026-08-12'
const E = '2026-08-20'
const s = formatDateMonthDay(S)
const e = formatDateMonthDay(E)

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
})
