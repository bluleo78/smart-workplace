import { expect, test } from 'vitest'

import { buildRRule, parseRRule } from './recurrence'

test('build weekly interval2 until', () => {
  expect(
    buildRRule({ freq: 'WEEKLY', interval: 2, end: { type: 'until', date: '2026-08-01' } }),
  ).toBe('FREQ=WEEKLY;INTERVAL=2;UNTIL=20260801T235959Z')
})

test('build daily count', () => {
  expect(buildRRule({ freq: 'DAILY', interval: 1, end: { type: 'count', count: 10 } })).toBe(
    'FREQ=DAILY;COUNT=10',
  )
})

test('build none → null', () => {
  expect(buildRRule({ freq: 'NONE', interval: 1, end: { type: 'none' } })).toBeNull()
})

test('build monthly no end, interval1', () => {
  expect(buildRRule({ freq: 'MONTHLY', interval: 1, end: { type: 'none' } })).toBe('FREQ=MONTHLY')
})

test('parse roundtrip monthly interval3', () => {
  expect(parseRRule('FREQ=MONTHLY;INTERVAL=3')).toEqual({
    freq: 'MONTHLY',
    interval: 3,
    end: { type: 'none' },
  })
})

test('parse until', () => {
  expect(parseRRule('FREQ=WEEKLY;UNTIL=20260801T235959Z')).toEqual({
    freq: 'WEEKLY',
    interval: 1,
    end: { type: 'until', date: '2026-08-01' },
  })
})

test('parse count', () => {
  expect(parseRRule('FREQ=DAILY;COUNT=5')).toEqual({
    freq: 'DAILY',
    interval: 1,
    end: { type: 'count', count: 5 },
  })
})

test('parse null → none', () => {
  expect(parseRRule(null)).toEqual({ freq: 'NONE', interval: 1, end: { type: 'none' } })
})

test('parse empty → none', () => {
  expect(parseRRule('')).toEqual({ freq: 'NONE', interval: 1, end: { type: 'none' } })
})

test('parse unknown FREQ → none', () => {
  expect(parseRRule('FREQ=YEARLY;INTERVAL=2')).toEqual({
    freq: 'NONE',
    interval: 1,
    end: { type: 'none' },
  })
})
