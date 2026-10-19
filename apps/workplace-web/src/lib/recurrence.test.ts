import { expect, test } from 'vitest'

import { buildRRule, parseRRule } from './recurrence'

test('build weekly interval2 until', () => {
  expect(
    buildRRule({ freq: 'WEEKLY', interval: 2, end: { type: 'until', date: '2026-08-01' } }),
  ).toBe('FREQ=WEEKLY;INTERVAL=2;UNTIL=20260801T145959Z')
})

test('build daily count', () => {
  expect(buildRRule({ freq: 'DAILY', interval: 1, end: { type: 'count', count: 10 } })).toBe(
    'FREQ=DAILY;COUNT=10',
  )
})

// 캘린더 폼 "매주"만 고른 기본값 — interval 1 은 생략해 FREQ 만 남는다(E2E 에서 옮겨 온 판정).
test('build weekly interval1 no end', () => {
  expect(buildRRule({ freq: 'WEEKLY', interval: 1, end: { type: 'none' } })).toBe('FREQ=WEEKLY')
})

// 폼 "매주 · 간격 2 · 횟수 3" — INTERVAL 다음 COUNT 순서(E2E 에서 옮겨 온 판정).
test('build weekly interval2 count3', () => {
  expect(buildRRule({ freq: 'WEEKLY', interval: 2, end: { type: 'count', count: 3 } })).toBe(
    'FREQ=WEEKLY;INTERVAL=2;COUNT=3',
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
  expect(parseRRule('FREQ=WEEKLY;UNTIL=20260801T145959Z')).toEqual({
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

// WP-535: 종료일은 한국 시간 그날 끝(23:59:59 KST = 14:59:59Z)이다. UTC 하루 끝(다음 날 08:59 KST)으로 두면
// 09시 이전 시작·종일 일정이 종료일 다음 날에도 한 번 더 생겼다.
test('build until = 한국 시간 그날 끝', () => {
  expect(
    buildRRule({ freq: 'DAILY', interval: 1, end: { type: 'until', date: '2026-11-18' } }),
  ).toBe('FREQ=DAILY;UNTIL=20261118T145959Z')
})

// 종료일 복원은 일정 시작 시각을 기준으로 「마지막 회차가 생기는 한국 날짜」로 — 예전 형식(UTC 하루 끝)이나 「이후 모두」 분할이 만든
// UNTIL(다음 회차 직전)도 다시 저장했을 때 회차가 늘지 않게 한다.
test('parse until — 예전 UTC 하루 끝 형식은 실제로 회차가 생기는 마지막 날로', () => {
  // 11/18 23:59:59Z = 11/19 08:59:59 KST → 08:30 시작은 19일 회차까지, 20:00 시작은 18일 회차까지 생긴다.
  expect(parseRRule('FREQ=DAILY;UNTIL=20261118T235959Z', '2026-11-16T08:30:00+09:00').end).toEqual({
    type: 'until',
    date: '2026-11-19',
  })
  expect(parseRRule('FREQ=DAILY;UNTIL=20261118T235959Z', '2026-11-16T20:00:00+09:00').end).toEqual({
    type: 'until',
    date: '2026-11-18',
  })
})

test('parse until — 「이후 모두」 분할 UNTIL(다음 회차 1초 전)은 그 전날', () => {
  // 11/10 08:00 KST 회차에서 분할 → UNTIL 11/10 07:59:59 KST(= 11/9 22:59:59Z) → 마지막 회차는 11/9.
  expect(parseRRule('FREQ=DAILY;UNTIL=20261109T225959Z', '2026-11-02T08:00:00+09:00').end).toEqual({
    type: 'until',
    date: '2026-11-09',
  })
})

test('parse until — 종일 일정(00:00 KST 시작)은 한국 날짜 그대로', () => {
  expect(parseRRule('FREQ=DAILY;UNTIL=20261105T145959Z', '2026-11-02T00:00:00+09:00').end).toEqual({
    type: 'until',
    date: '2026-11-05',
  })
})
