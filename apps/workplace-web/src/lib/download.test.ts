// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadBlob, REVOKE_DELAY_MS } from './download'

describe('downloadBlob', () => {
  const revoke = vi.fn()
  beforeEach(() => {
    vi.useFakeTimers()
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = revoke
  })
  afterEach(() => {
    vi.useRealTimers()
    revoke.mockReset()
  })
  it('클릭 직후가 아니라 지연 뒤에 object URL 을 해제한다(iOS 저장 실패 방지)', () => {
    downloadBlob('a.txt', new Blob(['x']))
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REVOKE_DELAY_MS)
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })
})
