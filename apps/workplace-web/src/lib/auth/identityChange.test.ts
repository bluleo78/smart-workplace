/**
 * 신원 바뀜 알림 모듈 테스트 (WP-1534) — 구독·해지, 동기 호출, 한 구독자 오류가 나머지를 막지 않음.
 */
import { describe, expect, test, vi } from 'vitest'

import { emitIdentityChange, onIdentityChange } from './identityChange'

describe('identityChange', () => {
  test('알리면 구독자를 그 자리에서(동기로) 부른다', () => {
    const listener = vi.fn()
    const off = onIdentityChange(listener)
    emitIdentityChange()
    expect(listener).toHaveBeenCalledTimes(1)
    off()
  })

  test('구독을 떼면 더 부르지 않는다', () => {
    const listener = vi.fn()
    const off = onIdentityChange(listener)
    off()
    emitIdentityChange()
    expect(listener).not.toHaveBeenCalled()
  })

  test('한 구독자가 던져도 나머지 구독자는 불린다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = onIdentityChange(() => {
      throw new Error('깨짐')
    })
    const good = vi.fn()
    const off = onIdentityChange(good)
    expect(() => emitIdentityChange()).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)
    bad()
    off()
  })
})
