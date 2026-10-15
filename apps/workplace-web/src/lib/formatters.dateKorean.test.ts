// formatDateKorean·formatDateTimeMinute(WP-412) — 이슈 목록 마감일·활동/코멘트 시각 포맷 단위 테스트.
// vitest.config 가 TZ=Asia/Seoul 고정이라 UTC→로컬 변환 결과가 결정적이다.
import { describe, expect, it } from 'vitest'

import { formatDateKorean, formatDateTimeMinute } from './formatters'

describe('formatDateKorean', () => {
  it('yyyy-MM-dd → "YYYY년 M월 D일" (월·일 zero-pad 없음, 타임존 시프트 없음)', () => {
    expect(formatDateKorean('2026-06-30')).toBe('2026년 6월 30일')
    expect(formatDateKorean('2026-01-05')).toBe('2026년 1월 5일')
  })

  it('값이 없거나 형식이 틀리면 "-"', () => {
    for (const v of [null, undefined, '', '2026-06', 'abc-de-fg', '2026-00-10']) {
      expect(formatDateKorean(v)).toBe('-')
    }
  })
})

describe('formatDateTimeMinute', () => {
  it('UTC 타임스탬프를 로컬(KST) "YYYY-MM-DD HH:mm" 로 — 초는 버린다', () => {
    expect(formatDateTimeMinute('2026-06-07T00:22:52Z')).toBe('2026-06-07 09:22')
    expect(formatDateTimeMinute('2026-06-08T03:06:36Z')).toBe('2026-06-08 12:06')
  })

  it('값이 없거나 무효면 "-"', () => {
    for (const v of [null, undefined, '', 'not-a-date']) expect(formatDateTimeMinute(v)).toBe('-')
  })
})
