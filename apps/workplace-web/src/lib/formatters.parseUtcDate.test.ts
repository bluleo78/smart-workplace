import { describe, expect, it } from 'vitest'

import { formatDateOnly, parseUtcDate } from './formatters'

// #617 회귀: parseUtcDate 의 오프셋 판별 정규식이 콜론 포함 오프셋(+09:00)을 인식하지 못해
// 이미 오프셋이 붙은 문자열에 'Z'를 중복 append(→ Invalid Date)하던 버그.
describe('parseUtcDate — 타임존 오프셋 판별', () => {
  it('콜론 포함 오프셋(+09:00)을 타임존 정보로 인식해 그대로 파싱한다', () => {
    const d = parseUtcDate('2026-07-15T23:59:59+09:00')
    expect(Number.isNaN(d.getTime())).toBe(false)
    // +09:00 14:59:59 UTC 이므로 ISO(UTC) 표현으로 검증
    expect(d.toISOString()).toBe('2026-07-15T14:59:59.000Z')
  })

  it('콜론 포함 음수 오프셋(-05:00)도 인식한다', () => {
    const d = parseUtcDate('2026-07-15T23:59:59-05:00')
    expect(Number.isNaN(d.getTime())).toBe(false)
    expect(d.toISOString()).toBe('2026-07-16T04:59:59.000Z')
  })

  it('콜론 없는 오프셋(+0900)도 인식한다', () => {
    const d = parseUtcDate('2026-07-15T23:59:59+0900')
    expect(Number.isNaN(d.getTime())).toBe(false)
  })

  it("'Z' 오프셋을 인식한다", () => {
    const d = parseUtcDate('2026-07-15T23:59:59Z')
    expect(Number.isNaN(d.getTime())).toBe(false)
    expect(d.toISOString()).toBe('2026-07-15T23:59:59.000Z')
  })

  it('오프셋이 없는 LocalDateTime 문자열은 UTC로 간주(Z append)한다', () => {
    const d = parseUtcDate('2026-07-15T23:59:59')
    expect(Number.isNaN(d.getTime())).toBe(false)
    expect(d.toISOString()).toBe('2026-07-15T23:59:59.000Z')
  })
})

describe('formatDateOnly — 콜론 포함 오프셋 입력', () => {
  it('OffsetDateTime(+09:00) 직렬화 문자열도 "-" 없이 정상 표시한다', () => {
    // 회귀: 예전엔 이 케이스가 Invalid Date → "-" 로 표시되었음
    expect(formatDateOnly('2026-07-15T23:59:59+09:00')).not.toBe('-')
  })
})
