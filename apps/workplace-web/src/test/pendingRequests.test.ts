import { describe, expect, it, vi } from 'vitest'

import { waitForPendingRequests } from './pendingRequests'

// 파일 끝에서 진행 중인 요청을 기다리는 도우미의 판정(WP-1967).
describe('waitForPendingRequests', () => {
  it('비어 있으면 setTimeout 을 부르지 않고 true', async () => {
    const setTimeout = vi.fn()
    const ok = await waitForPendingRequests(new Set<string>(), { timeoutMs: 50, intervalMs: 10, setTimeout })
    expect(ok).toBe(true)
    expect(setTimeout).not.toHaveBeenCalled()
  })

  it('요청이 끝나면 true', async () => {
    const pending = new Set<string>(['a'])
    let calls = 0
    const ok = await waitForPendingRequests(pending, {
      timeoutMs: 100,
      intervalMs: 10,
      setTimeout: (fn, ms) => {
        calls += 1
        // 두 번째 대기 전에 요청이 끝난 것으로 본다.
        if (calls === 2) pending.delete('a')
        return globalThis.setTimeout(fn, ms)
      },
    })
    expect(ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('상한을 넘기면 false', async () => {
    const setTimeout = vi.fn((fn: () => void) => {
      queueMicrotask(fn)
    })
    const ok = await waitForPendingRequests(new Set<string>(['a']), { timeoutMs: 50, intervalMs: 10, setTimeout })
    expect(ok).toBe(false)
    expect(setTimeout).toHaveBeenCalledTimes(5)
  })

  it('intervalMs 가 0 이하면 던진다(무한 대기 방지)', async () => {
    await expect(waitForPendingRequests(new Set<string>(['a']), { timeoutMs: 50, intervalMs: 0, setTimeout: vi.fn() })).rejects.toThrow('intervalMs')
  })
})
