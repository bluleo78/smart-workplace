// withTimeout — 로그아웃이 멈춘 푸시 구독 해제에 막히지 않게 하는 부드러운 타임아웃.
// E2E 에서 실제 3초를 기다리던 경계 검증을 가짜 타이머로 옮겼다(WP-410).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withTimeout } from './withTimeout'

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('시간 안에 끝나면 원래 결과를 돌려주고 타이머를 남기지 않는다', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 3000)).resolves.toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('끝나지 않는 promise 는 ms 직전까지 대기하고 ms 에 undefined 로 이행한다(reject 아님)', async () => {
    const settled = vi.fn()
    void withTimeout(new Promise<string>(() => {}), 3000).then(settled)

    await vi.advanceTimersByTimeAsync(2999)
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toHaveBeenCalledWith(undefined)
  })

  it('원래 promise 가 먼저 reject 하면 그 에러를 전파한다', async () => {
    const err = new Error('boom')
    await expect(withTimeout(Promise.reject(err), 3000)).rejects.toBe(err)
    expect(vi.getTimerCount()).toBe(0)
  })
})
