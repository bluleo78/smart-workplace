import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { afterInitialRefresh, markInitialRefreshSettled, resetAuthBootForTest } from './authBoot'

beforeEach(() => {
  resetAuthBootForTest()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('authBoot (WP-2087)', () => {
  it('afterInitialRefresh_runsAfterSignal', () => {
    const cb = vi.fn()
    afterInitialRefresh(cb)
    expect(cb).not.toHaveBeenCalled()
    markInitialRefreshSettled()
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(cb).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('afterInitialRefresh_runsOnNextTaskWhenAlreadySettled', async () => {
    markInitialRefreshSettled()
    const cb = vi.fn()
    afterInitialRefresh(cb)
    await Promise.resolve()
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('afterInitialRefresh_runsAfterSynchronousWorkFollowingSignal', () => {
    // initAuth 처럼 신호 직후 같은 동기 구간에서 요청을 보내는 코드가 waiter 보다 먼저 돈다.
    const order: string[] = []
    afterInitialRefresh(() => order.push('waiter'))
    markInitialRefreshSettled()
    order.push('sync-after-signal')
    vi.advanceTimersByTime(0)
    expect(order).toEqual(['sync-after-signal', 'waiter'])
  })

  it('afterInitialRefresh_fallsBackAfter3000ms', () => {
    const cb = vi.fn()
    afterInitialRefresh(cb)
    vi.advanceTimersByTime(2999)
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(cb).toHaveBeenCalledTimes(1)
    markInitialRefreshSettled()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('afterInitialRefresh_cancelBeforeSignalPreventsCall', () => {
    const cb = vi.fn()
    afterInitialRefresh(cb)()
    markInitialRefreshSettled()
    vi.advanceTimersByTime(5000)
    expect(cb).not.toHaveBeenCalled()
  })

  it('afterInitialRefresh_cancelAfterSignalClearsPendingTimer', () => {
    const cb = vi.fn()
    const cancel = afterInitialRefresh(cb)
    markInitialRefreshSettled()
    cancel()
    vi.advanceTimersByTime(5000)
    expect(cb).not.toHaveBeenCalled()
  })

  it('afterInitialRefresh_cancelWhenAlreadySettledPreventsCall', () => {
    markInitialRefreshSettled()
    const cb = vi.fn()
    afterInitialRefresh(cb)()
    vi.advanceTimersByTime(5000)
    expect(cb).not.toHaveBeenCalled()
  })

  it('markInitialRefreshSettled_idempotent', () => {
    const cb = vi.fn()
    afterInitialRefresh(cb)
    markInitialRefreshSettled()
    markInitialRefreshSettled()
    vi.advanceTimersByTime(0)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
