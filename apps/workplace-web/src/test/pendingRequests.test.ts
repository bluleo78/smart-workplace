import { describe, expect, it, vi } from 'vitest'

import { describePendingRequests, RESPONSE_DELIVERY_MS, settleDelayMs, waitForPendingRequests } from './pendingRequests'

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

// 서버를 닫기 전 더 기다릴 시간(WP-1967 리뷰 후속) — 직전에 끝난 요청의 이벤트 전달을 기다린다.
describe('settleDelayMs', () => {
  it('직전(전달 시간 안)에 끝난 요청이 있으면 전달 시간만큼', () => {
    expect(settleDelayMs(995, 1000)).toBe(RESPONSE_DELIVERY_MS)
  })

  it('마지막 종료가 전달 시간보다 오래면 0(틱 하나)', () => {
    expect(settleDelayMs(1000 - RESPONSE_DELIVERY_MS, 1000)).toBe(0)
  })

  it('끝난 요청이 없었으면 0', () => {
    expect(settleDelayMs(0, 5)).toBe(0)
  })
})

// 상한을 넘겨 남은 요청의 경고 문구(WP-1967 리뷰 후속).
describe('describePendingRequests', () => {
  it('남은 요청 수와 method·URL 을 모두 적는다', () => {
    const pending = new Map([
      ['1', 'GET http://localhost/api/v1/users/me'],
      ['2', 'POST http://localhost/api/v1/issues'],
    ])
    expect(describePendingRequests(pending, 1500)).toBe(
      '파일 끝에서 1500ms 를 기다려도 끝나지 않은 MSW 요청 2개: GET http://localhost/api/v1/users/me, POST http://localhost/api/v1/issues',
    )
  })
})
