// #828 — toLocale* 직접 호출을 대체한 로케일 표기 유지용 포매터 회귀 테스트.
// vitest.config 가 TZ=Asia/Seoul 고정. 오전/오후는 포매터가 직접 붙여 ICU 와 무관하다(WP-1029) — 정확한 문자열로 본다.
import { describe, expect, it } from 'vitest'

import {
  clock24,
  formatClockTimePadded,
  formatDateMonthDayPadded,
  formatDateShort,
  formatDateTimeLocale,
  formatHourLabel24,
  formatLocalClockRange24,
  formatLocalClockTime24,
  formatLocalMoveRange24,
  formatMonthDayWeekdayClock24,
  formatNumber,
  isNextMidnightEnd,
} from './formatters'

const INVALID = [null, undefined, '', 'not-a-date']

describe('formatLocalClockTime24', () => {
  it('24시간 "HH:mm" — 로컬(KST) 기준, 자정은 00:00', () => {
    expect(formatLocalClockTime24('2026-07-15T05:30:00Z')).toBe('14:30')
    expect(formatLocalClockTime24('2026-07-14T15:00:00Z')).toBe('00:00')
    expect(formatLocalClockTime24('2026-07-15T09:05:00+09:00')).toBe('09:05')
  })
  it('무효 입력 → "-"', () => {
    for (const v of INVALID) expect(formatLocalClockTime24(v)).toBe('-')
  })
})

describe('formatClockTimePadded', () => {
  it('12시간제 + 시 zero-pad ("오후 02:30")', () => {
    // 오전/오후는 ICU 와 무관하게 한국어(WP-1029). 로컬 타임존 기준이라 TZ=Asia/Seoul(테스트 설정) 값이다.
    expect(formatClockTimePadded('2026-07-15T05:30:00Z')).toBe('오후 02:30')
    expect(formatClockTimePadded('2026-07-15T00:05:00Z')).toBe('오전 09:05')
    expect(formatClockTimePadded('2026-07-15T03:00:00Z')).toBe('오후 12:00')
  })
  it('무효 입력 → "-"', () => {
    for (const v of INVALID) expect(formatClockTimePadded(v)).toBe('-')
  })
})

describe('formatDateMonthDayPadded', () => {
  it('월·일 2자리 ("07. 05.")', () => {
    expect(formatDateMonthDayPadded('2026-07-05T05:30:00Z')).toBe('07. 05.')
    // UTC 15:00 = KST 다음날
    expect(formatDateMonthDayPadded('2026-12-31T15:00:00Z')).toBe('01. 01.')
  })
  it('무효 입력 → "-"', () => {
    for (const v of INVALID) expect(formatDateMonthDayPadded(v)).toBe('-')
  })
})

describe('formatDateTimeLocale', () => {
  it('ko-KR 전체 일시 ("2026. 7. 5. 오후 2:30:00")', () => {
    expect(formatDateTimeLocale('2026-07-05T05:30:00Z')).toBe('2026. 7. 5. 오후 2:30:00')
    expect(formatDateTimeLocale('2026-07-04T15:00:09Z')).toBe('2026. 7. 5. 오전 12:00:09')
  })
  it('무효 입력 → "-"', () => {
    for (const v of INVALID) expect(formatDateTimeLocale(v)).toBe('-')
  })
})

describe('formatDateShort', () => {
  it('ko-KR 날짜 ("2026. 7. 5.")', () => {
    expect(formatDateShort('2026-07-05T05:30:00Z')).toBe('2026. 7. 5.')
  })
  it('무효 입력 → "-"', () => {
    for (const v of INVALID) expect(formatDateShort(v)).toBe('-')
  })
})

describe('formatNumber', () => {
  it('천단위 구분', () => {
    expect(formatNumber(Number.MAX_SAFE_INTEGER)).toBe('9,007,199,254,740,991')
    expect(formatNumber(-1234)).toBe('-1,234')
    expect(formatNumber(0)).toBe('0')
  })
})

// WP-1909 — 캘린더 24시간 표기 부품. TZ=Asia/Seoul 고정, ICU 비의존.
describe('clock24 · formatHourLabel24', () => {
  it('자정 00:00 · 정오 12:00 · 23:59', () => {
    expect(clock24(new Date(2026, 6, 15, 0, 0))).toBe('00:00')
    expect(clock24(new Date(2026, 6, 15, 12, 0))).toBe('12:00')
    expect(clock24(new Date(2026, 6, 15, 23, 59))).toBe('23:59')
  })
  it('시 눈금 라벨 00:00 … 23:00', () => {
    expect(formatHourLabel24(0)).toBe('00:00')
    expect(formatHourLabel24(9)).toBe('09:00')
    expect(formatHourLabel24(23)).toBe('23:00')
  })
})

describe('formatLocalClockRange24', () => {
  it('일반 구간 · 자정 시작 · 정오', () => {
    expect(formatLocalClockRange24(new Date(2026, 6, 15, 9, 0), new Date(2026, 6, 15, 10, 30))).toBe('09:00 – 10:30')
    expect(formatLocalClockRange24(new Date(2026, 6, 15, 0, 0), new Date(2026, 6, 15, 12, 0))).toBe('00:00 – 12:00')
    expect(formatLocalClockRange24(new Date(2026, 6, 15, 23, 0), new Date(2026, 6, 15, 23, 59))).toBe('23:00 – 23:59')
  })
  it('끝이 다음 날 0시면 끝을 24:00 으로', () => {
    expect(formatLocalClockRange24(new Date(2026, 6, 15, 22, 0), new Date(2026, 6, 16, 0, 0))).toBe('22:00 – 24:00')
  })
  it('길이 0 구간은 00:00 – 00:00 그대로', () => {
    expect(formatLocalClockRange24(new Date(2026, 6, 15, 0, 0), new Date(2026, 6, 15, 0, 0))).toBe('00:00 – 00:00')
  })
})

describe('isNextMidnightEnd (WP-1909 리뷰 후속)', () => {
  it('정확한 다음 날 0시만 참 — 초·밀리초가 붙으면 거짓', () => {
    const start = new Date(2026, 6, 15, 22, 0)
    expect(isNextMidnightEnd(start, new Date(2026, 6, 16, 0, 0, 0, 0))).toBe(true)
    expect(isNextMidnightEnd(start, new Date(2026, 6, 16, 0, 0, 30))).toBe(false)
    expect(isNextMidnightEnd(start, new Date(2026, 6, 16, 0, 0, 0, 1))).toBe(false)
  })
  it('길이 0 구간은 거짓', () => {
    const t = new Date(2026, 6, 15, 0, 0)
    expect(isNextMidnightEnd(t, t)).toBe(false)
  })
})

describe('formatLocalMoveRange24 (WP-1909 리뷰 후속)', () => {
  it('하루 안·자정 종료는 날짜 없이(자정 끝 24:00)', () => {
    expect(formatLocalMoveRange24(new Date(2026, 9, 21, 9, 0), new Date(2026, 9, 21, 10, 30))).toBe('09:00 – 10:30')
    expect(formatLocalMoveRange24(new Date(2026, 9, 21, 22, 0), new Date(2026, 9, 22, 0, 0))).toBe('22:00 – 24:00')
  })
  it('여러 날이면 양 끝에 날짜 — 끝은 24:00 이 아니라 그 날짜 00:00', () => {
    expect(formatLocalMoveRange24(new Date(2026, 9, 21, 22, 0), new Date(2026, 9, 23, 0, 0))).toBe('10/21 22:00 – 10/23 00:00')
    expect(formatLocalMoveRange24(new Date(2026, 9, 21, 22, 0), new Date(2026, 9, 22, 1, 0))).toBe('10/21 22:00 – 10/22 01:00')
  })
  it('길이 0·끝이 시작보다 앞선 구간은 날짜 없이 그대로', () => {
    expect(formatLocalMoveRange24(new Date(2026, 9, 21, 0, 0), new Date(2026, 9, 21, 0, 0))).toBe('00:00 – 00:00')
    expect(formatLocalMoveRange24(new Date(2026, 9, 21, 10, 0), new Date(2026, 9, 21, 9, 0))).toBe('10:00 – 09:00')
  })
  it('해가 바뀌면 양 끝에 연도', () => {
    expect(formatLocalMoveRange24(new Date(2026, 11, 31, 22, 0), new Date(2027, 0, 2, 1, 0))).toBe('2026/12/31 22:00 – 2027/1/2 01:00')
    expect(formatLocalMoveRange24(new Date(2026, 11, 31, 22, 0), new Date(2027, 0, 1, 0, 0))).toBe('22:00 – 24:00')
  })
})

describe('formatMonthDayWeekdayClock24', () => {
  const NOW = new Date(2026, 9, 1)
  it('올해 — 월일 (요일) 24시간 시각, 자정은 00:30', () => {
    expect(formatMonthDayWeekdayClock24('2026-10-23T05:05:00Z', NOW)).toBe('10월 23일 (금) 14:05')
    expect(formatMonthDayWeekdayClock24('2026-10-22T15:30:00Z', NOW)).toBe('10월 23일 (금) 00:30')
  })
  it('무효 입력 → 빈 문자열', () => {
    for (const v of INVALID) expect(formatMonthDayWeekdayClock24(v, NOW)).toBe('')
  })
})
