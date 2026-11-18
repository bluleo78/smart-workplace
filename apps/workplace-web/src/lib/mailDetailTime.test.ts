// 메일 상세 수신 일시 표기(WP-1723) — 오늘·올해·작년 표기, 빈 값, 요일 직접 계산,
// 자정 경계(직전/직후)를 로컬(vitest TZ=Asia/Seoul) 기준으로 고정 검증한다.
import { expect, test } from 'vitest'

import { formatMailHeaderTime } from './mailDetailTime'

// 기준 시각: 2026-11-18(수) 00:30 KST.
const NOW = new Date('2026-11-17T15:30:00Z')

test('값이 없으면 빈 문자열을 반환한다', () => {
  expect(formatMailHeaderTime(null)).toBe('')
  expect(formatMailHeaderTime('', NOW)).toBe('')
  expect(formatMailHeaderTime('아닌 문자열', NOW)).toBe('')
})

test('오늘 메일은 「오늘 HH:mm」으로 표기하고 시·분을 zero-pad 한다', () => {
  // 2026-11-17T15:12:00Z = 2026-11-18 00:12 KST — 기준 시각의 같은 날(오늘).
  expect(formatMailHeaderTime('2026-11-17T15:12:00Z', NOW)).toBe('오늘 00:12')
})

test('올해 메일은 「M/D (요일) HH:mm」으로 표기한다(월·일 zero-pad 없음)', () => {
  // 2026-06-03T01:00:00Z = 2026-06-03 10:00 KST (수) — 페이지 테스트 데이터와 같은 시각.
  expect(formatMailHeaderTime('2026-06-03T01:00:00Z', NOW)).toBe('6/3 (수) 10:00')
})

test('올해가 아닌 메일은 연도를 붙인다', () => {
  // 2025-03-02T00:30:00Z = 2025-03-02 09:30 KST (일).
  expect(formatMailHeaderTime('2025-03-02T00:30:00Z', NOW)).toBe('2025/3/2 (일) 09:30')
})

test('요일은 날짜에서 직접 계산한다 — 2026-11-18 은 수, 하루 전은 화', () => {
  // 기준을 다음 날 자정으로 두어 두 입력 모두 '오늘'이 되지 않게 한다.
  const NEXT_DAY = new Date('2026-11-18T15:00:00Z') // 2026-11-19 00:00 KST
  expect(formatMailHeaderTime('2026-11-18T05:00:00Z', NEXT_DAY)).toBe('11/18 (수) 14:00')
  expect(formatMailHeaderTime('2026-11-17T05:00:00Z', NEXT_DAY)).toBe('11/17 (화) 14:00')
})

test('자정 경계 — 직전은 어제 표기, 자정이 되는 순간은 오늘 표기', () => {
  const midnight = new Date('2026-11-17T15:00:00Z') // 2026-11-18 00:00 KST
  expect(formatMailHeaderTime('2026-11-17T14:59:00Z', midnight)).toBe('11/17 (화) 23:59')
  expect(formatMailHeaderTime('2026-11-17T15:00:00Z', midnight)).toBe('오늘 00:00')
})