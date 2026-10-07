import { describe, expect, it } from 'vitest'

import { detectIOS } from './platform'

describe('detectIOS', () => {
  it('iPhone·iPad UA', () => {
    expect(detectIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 })).toBe(true)
  })
  it('iPadOS 데스크톱 UA 는 MacIntel + 터치 포인트로 보정', () => {
    expect(detectIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
    expect(detectIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
  })
  it('Android 는 아님', () => {
    expect(detectIOS({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false)
  })
})
