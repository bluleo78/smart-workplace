// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadBlob, REVOKE_DELAY_MS } from './download'

describe('downloadBlob', () => {
  const revoke = vi.fn()
  // jsdom 에는 createObjectURL 이 없어(undefined) spyOn 을 못 쓴다 — 원래 값을 들고 있다가 되돌려 다른 테스트로 새지 않게.
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  beforeEach(() => {
    vi.useFakeTimers()
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = revoke
  })
  afterEach(() => {
    vi.useRealTimers()
    revoke.mockReset()
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
  })
  it('클릭 직후가 아니라 지연 뒤에 object URL 을 해제한다(iOS 저장 실패 방지)', () => {
    downloadBlob('a.txt', new Blob(['x']))
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REVOKE_DELAY_MS)
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })
})
