// Gen:iA 브라우저 로그인(WP-1461) 남은 시간 문구 — 「남은 시간 M:SS」, 지나면 0:00.
import { describe, expect, test } from 'vitest'

import { formatGeniaLoginRemaining, GENIA_LOGIN_POLL_MS } from './geniaLogin'

const NOW = Date.parse('2026-11-12T01:00:00Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()

describe('formatGeniaLoginRemaining', () => {
  test('10분 남으면 「남은 시간 10:00」', () => {
    expect(formatGeniaLoginRemaining(at(600_000), NOW)).toBe('남은 시간 10:00')
  })

  test('61초 남으면 「남은 시간 1:01」', () => {
    expect(formatGeniaLoginRemaining(at(61_000), NOW)).toBe('남은 시간 1:01')
  })

  test('1초 조금 덜 남아도 초를 올려 「0:01」 — 막 받은 10분이 9:59 로 시작하지 않게', () => {
    expect(formatGeniaLoginRemaining(at(999), NOW)).toBe('남은 시간 0:01')
    expect(formatGeniaLoginRemaining(at(599_990), NOW)).toBe('남은 시간 10:00')
  })

  test('지났으면 「남은 시간 0:00」', () => {
    expect(formatGeniaLoginRemaining(at(-5_000), NOW)).toBe('남은 시간 0:00')
  })
})

test('상태는 2초마다 다시 묻는다', () => {
  expect(GENIA_LOGIN_POLL_MS).toBe(2000)
})
