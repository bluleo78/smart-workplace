// src/lib/pwa/updateCheck.test.ts
// startSwUpdateChecks 단위 테스트 — 주기·화면 복귀 시점에 update() 를 부르고, 오프라인·쿨다운이면 건너뛰는지.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startSwUpdateChecks, UPDATE_CHECK_COOLDOWN_MS, UPDATE_CHECK_INTERVAL_MS } from './updateCheck'

/** visibilitychange 를 수동으로 쏠 수 있는 최소 document 대역 */
function fakeDoc(initial: DocumentVisibilityState = 'visible') {
  const target = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState }
  target.visibilityState = initial
  return {
    doc: target,
    win: new EventTarget(),
    show() {
      target.visibilityState = 'visible'
      target.dispatchEvent(new Event('visibilitychange'))
    },
    hide() {
      target.visibilityState = 'hidden'
      target.dispatchEvent(new Event('visibilitychange'))
    },
  }
}

describe('startSwUpdateChecks', () => {
  let update: ReturnType<typeof vi.fn<() => Promise<unknown>>>
  let online: boolean

  beforeEach(() => {
    vi.useFakeTimers()
    update = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined)
    online = true
  })
  afterEach(() => vi.useRealTimers())

  /** 확인을 시작하고, 시작 직후 쿨다운을 지나 보낸 상태로 만든다(각 시점의 호출만 보려고). */
  const start = ({ doc, win }: ReturnType<typeof fakeDoc>) => {
    const stop = startSwUpdateChecks({ update }, { doc, win, isOnline: () => online })
    vi.advanceTimersByTime(UPDATE_CHECK_COOLDOWN_MS)
    return stop
  }

  it('페이지 로드 직후(쿨다운 안)의 화면 복귀는 건너뜀 — 브라우저가 방금 확인했으므로', () => {
    const f = fakeDoc()
    startSwUpdateChecks({ update }, { doc: f.doc, win: f.win, isOnline: () => online })
    f.show()
    expect(update).not.toHaveBeenCalled()
  })

  it('숨겨진 동안에는 주기 확인을 하지 않음', () => {
    start(fakeDoc('hidden'))
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 2)
    expect(update).not.toHaveBeenCalled()
  })

  it('주기마다 update 를 호출', () => {
    start(fakeDoc())
    expect(update).not.toHaveBeenCalled()
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)
    expect(update).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('화면에 다시 보이면 update 호출, 숨겨질 때는 호출하지 않음', () => {
    const f = fakeDoc('hidden')
    start(f)
    f.hide()
    expect(update).not.toHaveBeenCalled()
    f.show()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('직전 확인 후 쿨다운 안이면 건너뛰고, 지나면 다시 호출', () => {
    const f = fakeDoc()
    start(f)
    f.show()
    f.hide()
    f.show()
    expect(update).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(UPDATE_CHECK_COOLDOWN_MS)
    f.show()
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('오프라인이면 건너뜀', () => {
    const f = fakeDoc()
    start(f)
    online = false
    f.show()
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)
    expect(update).not.toHaveBeenCalled()
  })

  it('복귀 순간 오프라인이었으면 다시 연결될 때 확인, 숨겨진 상태의 재연결은 무시', () => {
    const f = fakeDoc()
    start(f)
    online = false
    f.show()
    expect(update).not.toHaveBeenCalled()
    online = true
    f.win.dispatchEvent(new Event('online'))
    expect(update).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(UPDATE_CHECK_COOLDOWN_MS)
    f.hide()
    f.win.dispatchEvent(new Event('online'))
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('update 실패는 삼킨다(네트워크 오류로 앱이 깨지지 않게)', async () => {
    update.mockRejectedValueOnce(new Error('offline'))
    const f = fakeDoc()
    start(f)
    f.show()
    await vi.runOnlyPendingTimersAsync()
    expect(update).toHaveBeenCalled()
  })

  it('정리 함수를 부르면 더 이상 호출하지 않음', () => {
    const f = fakeDoc()
    const stop = start(f)
    stop()
    f.show()
    f.win.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 2)
    expect(update).not.toHaveBeenCalled()
  })
})
