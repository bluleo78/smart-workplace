import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatDate } from './utils'

describe('formatDate', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('시간대 표기가 없는 값은 UTC 로 읽는다 — KST 오전 8시 생성은 그날로 보인다', () => {
    vi.stubEnv('TZ', 'Asia/Seoul')
    // UTC 10-23 23:00 = KST 10-24 08:00
    expect(formatDate('2026-10-23T23:00:00')).toBe('2026-10-24')
  })

  it('시간대 표기가 있는 값은 그대로 읽는다', () => {
    vi.stubEnv('TZ', 'Asia/Seoul')
    expect(formatDate('2026-10-23T23:00:00Z')).toBe('2026-10-24')
    expect(formatDate('2026-10-24T08:00:00+09:00')).toBe('2026-10-24')
  })

  it('파싱할 수 없는 값은 원문 그대로 돌려준다', () => {
    expect(formatDate('없음')).toBe('없음')
  })
})
