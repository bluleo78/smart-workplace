import { describe, expect, test } from 'vitest'

import {
  formatCompactNumber,
  formatDurationMs,
  formatPercent,
  formatPercentPointDiff,
} from './formatters'

// 지표(차트·메트릭 카드)용 숫자 포매터 — 소수 1자리, `.0` 생략, 유효하지 않은 입력은 EMPTY_GLYPH.
describe('formatCompactNumber', () => {
  test.each([
    [0, '0'], [999, '999'], [1000, '1K'], [1234, '1.2K'], [999_950, '1M'],
    [3_100_000, '3.1M'], [1_500_000_000, '1.5B'], [NaN, '—'], [-5, '—'], [Infinity, '—'],
  ])('formatCompactNumber(%s)', (n, s) => expect(formatCompactNumber(n)).toBe(s))
})

describe('formatPercent', () => {
  test.each([[0.123, '12.3%'], [0, '0%'], [1, '100%'], [NaN, '—'], [-0.1, '—']])(
    'formatPercent(%s)', (r, s) => expect(formatPercent(r)).toBe(s))
  test('digits', () => expect(formatPercent(0.12345, 2)).toBe('12.35%'))
  test('digits 0', () => expect(formatPercent(0.126, 0)).toBe('13%'))
})

describe('formatPercentPointDiff', () => {
  test.each([[0.05, 0.034, '+1.6%p'], [0.03, 0.034, '-0.4%p'], [0.1, 0.1, '0%p'], [NaN, 0.1, '—'], [0.1, Infinity, '—']])(
    'formatPercentPointDiff(%s,%s)', (a, b, s) => expect(formatPercentPointDiff(a, b)).toBe(s))
})

describe('formatDurationMs', () => {
  test.each([
    [850, '850ms'], [12_300, '12.3초'], [245_000, '4분 5초'], [240_000, '4분'],
    [7_380_000, '2시간 3분'], [-1, '—'], [NaN, '—'],
  ])('formatDurationMs(%s)', (ms, s) => expect(formatDurationMs(ms)).toBe(s))
})
