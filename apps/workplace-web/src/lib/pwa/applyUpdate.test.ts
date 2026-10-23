// src/lib/pwa/applyUpdate.test.ts
// 새 서비스워커 적용·새로고침 단위 테스트(WP-664) — 대기 중인 SW 를 활성화한 뒤에만 새로고침하는지,
// 다른 창은 실제 업데이트(관리 SW 교체)에만 반응하는지.
import { describe, expect, it, vi } from 'vitest'

import { applyWaitingUpdate, isApplyingUpdate, watchControllerUpdate } from './applyUpdate'

/** state 를 바꾸며 statechange 를 쏠 수 있는 최소 ServiceWorker 대역 */
function fakeSw(initial = 'installed') {
  const sw = new EventTarget() as EventTarget & { state: string }
  sw.state = initial
  return {
    sw,
    moveTo(state: string) {
      sw.state = state
      sw.dispatchEvent(new Event('statechange'))
    },
  }
}

/** 이벤트 루프를 한 번 돌려 await 사이의 진행을 반영한다. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('applyWaitingUpdate', () => {
  it('적용하는 동안은 이 창이 적용 중으로 보이고, 밀려나 적용되지 않으면 풀린다', async () => {
    const { sw, moveTo } = fakeSw()
    const done = applyWaitingUpdate(sw, vi.fn(), vi.fn())

    await flush()
    // 이 창에도 오는 관리 SW 교체를 PwaUpdatePrompt 가 다른 창 몫으로 처리(새로고침)하지 않게 하는 표시
    expect(isApplyingUpdate()).toBe(true)
    moveTo('redundant')
    await expect(done).resolves.toBe(false)
    expect(isApplyingUpdate()).toBe(false)
  })

  it('대기 중인 SW 를 활성화하라고 보내고, 활성화된 뒤에야 새로고침한다', async () => {
    const { sw, moveTo } = fakeSw()
    const skipWaiting = vi.fn()
    const reload = vi.fn()
    const done = applyWaitingUpdate(sw, skipWaiting, reload)

    await flush()
    expect(skipWaiting).toHaveBeenCalledTimes(1)
    moveTo('activating')
    await flush()
    expect(reload).not.toHaveBeenCalled()

    moveTo('activated')
    await done
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('활성화되지 않고 밀려나면(redundant) 새로고침하지 않고 실패를 알린다(옛 버전을 다시 받지 않게)', async () => {
    const { sw, moveTo } = fakeSw()
    const reload = vi.fn()
    const done = applyWaitingUpdate(sw, vi.fn(), reload)

    await flush()
    moveTo('redundant')
    await expect(done).resolves.toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('대기 중인 SW 가 없으면(다른 창이 이미 적용) 바로 새로고침한다', async () => {
    const skipWaiting = vi.fn()
    const reload = vi.fn()
    await applyWaitingUpdate(null, skipWaiting, reload)
    expect(skipWaiting).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('watchControllerUpdate', () => {
  /** controller 를 바꾸며 controllerchange 를 쏠 수 있는 최소 ServiceWorkerContainer 대역 */
  function fakeContainer(controller: unknown) {
    const container = new EventTarget() as EventTarget & { controller: unknown }
    container.controller = controller
    return {
      container,
      changeTo(next: unknown) {
        container.controller = next
        container.dispatchEvent(new Event('controllerchange'))
      },
    }
  }

  it('관리하던 SW 가 바뀌면 알리고, 정리 뒤에는 반응하지 않는다', () => {
    const { container, changeTo } = fakeContainer({ id: 'v1' })
    const onUpdate = vi.fn()
    const stop = watchControllerUpdate(container, onUpdate)

    changeTo({ id: 'v2' })
    expect(onUpdate).toHaveBeenCalledTimes(1)

    stop()
    changeTo({ id: 'v3' })
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('관리받지 않던 창이 처음 관리받게 되는 것은 업데이트가 아니다', () => {
    const { container, changeTo } = fakeContainer(null)
    const onUpdate = vi.fn()
    watchControllerUpdate(container, onUpdate)

    changeTo({ id: 'v1' })
    expect(onUpdate).not.toHaveBeenCalled()

    // 그 뒤의 교체는 업데이트다.
    changeTo({ id: 'v2' })
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
})
