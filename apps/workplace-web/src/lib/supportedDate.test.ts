import { describe, expect, it } from 'vitest'

import { isSupportedDateKey } from './supportedDate'

describe('isSupportedDateKey (WP-903)', () => {
  it('범위 안의 완성된 날짜만 참', () => {
    expect(isSupportedDateKey('2026-10-23')).toBe(true)
    expect(isSupportedDateKey('1900-01-01')).toBe(true)
    expect(isSupportedDateKey('9999-12-31')).toBe(true)
  })

  it('연도를 치는 도중의 값(0002·0020·0202)과 범위 밖은 거짓', () => {
    expect(isSupportedDateKey('0002-10-23')).toBe(false)
    expect(isSupportedDateKey('0202-10-23')).toBe(false)
    expect(isSupportedDateKey('1899-12-31')).toBe(false)
  })

  it('형식이 다르면(빈 값·5자리 연도) 거짓', () => {
    expect(isSupportedDateKey('')).toBe(false)
    expect(isSupportedDateKey('20260-10-23')).toBe(false)
  })
})
