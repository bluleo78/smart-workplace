// src/lib/pwa/outdatedApp.test.ts
// 옛 버전 앱의 404 복구 단위 테스트(WP-872) — 서버에 새 버전이 있을 때만 새 SW 를 적용해 같은 주소를 다시 열고,
// 진짜 없는 주소·같은 버전·이미 적용해 본 주소·떠난 화면은 404 를 그대로 보이는지.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type OutdatedAppEnv, recoverOutdatedApp, type UpdatableRegistration } from './outdatedApp'

/** state 를 바꾸며 statechange 를 쏠 수 있는 최소 ServiceWorker 대역(postMessage 로 SKIP_WAITING 을 받는다) */
function fakeSw(initial: string) {
  const sw = new EventTarget() as EventTarget & { state: string; postMessage: (msg: unknown) => void }
  sw.state = initial
  sw.postMessage = vi.fn()
  const moveTo = (state: string) => {
    sw.state = state
    sw.dispatchEvent(new Event('statechange'))
  }
  return { sw, moveTo }
}

type FakeSw = ReturnType<typeof fakeSw>['sw']

/** 등록 대역 — update() 가 부르면 onUpdate 로 설치 중인 SW 를 만들어 내거나(설치 시작) 던질(네트워크 실패) 수 있다. */
function fakeRegistration(init: { waiting?: FakeSw | null; onUpdate?: (reg: Reg) => void } = {}) {
  const reg: Reg = {
    waiting: init.waiting ?? null,
    installing: null,
    update: vi.fn(async () => {
      init.onUpdate?.(reg)
    }),
  }
  return reg
}

type Reg = UpdatableRegistration & { waiting: FakeSw | null; installing: FakeSw | null }

/** 메모리 sessionStorage 대역 */
function memoryStorage() {
  const map = new Map<string, string>()
  return { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v) }
}

/** 기본: 서버가 한 버전 위(0.9.15)이고 대기 중인 SW 는 없다. waiting 을 주면 그 SW 가 대기 중인 등록을 돌려준다. */
function env({ waiting, ...overrides }: Partial<OutdatedAppEnv> & { waiting?: FakeSw } = {}): OutdatedAppEnv {
  return {
    currentVersion: '0.9.14',
    path: '/wiki/share/wsh_x',
    fetchServerVersion: async () => '0.9.15',
    getRegistration: async () => fakeRegistration({ waiting }),
    storage: memoryStorage(),
    reload: vi.fn(),
    hasUnsavedInput: () => false,
    timeoutMs: 1000,
    ...overrides,
  }
}

/** 이벤트 루프를 한 번 돌려 await 사이의 진행을 반영한다. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('recoverOutdatedApp', () => {
  it('서버가 새 버전이고 새 SW 가 대기 중이면 활성화한 뒤 같은 주소를 다시 연다', async () => {
    const { sw, moveTo } = fakeSw('installed')
    const e = env({ waiting: sw })
    const done = recoverOutdatedApp(e)

    await flush()
    expect(sw.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(e.reload).not.toHaveBeenCalled()
    moveTo('activated')

    await expect(done).resolves.toBe(true)
    expect(e.reload).toHaveBeenCalledTimes(1)
  })

  it('대기 중인 SW 가 없으면 업데이트를 확인하고, 새 SW 설치가 끝나면 적용한다', async () => {
    const { sw, moveTo } = fakeSw('installing')
    const reg = fakeRegistration({ onUpdate: (r) => void (r.installing = sw) })
    const e = env({ getRegistration: async () => reg })
    const done = recoverOutdatedApp(e)

    await flush()
    expect(reg.update).toHaveBeenCalledTimes(1)
    expect(sw.postMessage).not.toHaveBeenCalled()
    reg.installing = null
    reg.waiting = sw
    moveTo('installed')
    await flush()
    expect(sw.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    moveTo('activated')

    await expect(done).resolves.toBe(true)
    expect(e.reload).toHaveBeenCalledTimes(1)
  })

  describe('제한 시간', () => {
    beforeEach(() => void vi.useFakeTimers())
    afterEach(() => void vi.useRealTimers())

    it('새 SW 설치가 제한 시간 안에 끝나지 않으면 404 를 보인다', async () => {
      const { sw } = fakeSw('installing')
      const reg = fakeRegistration({ onUpdate: (r) => void (r.installing = sw) })
      const e = env({ getRegistration: async () => reg })
      const done = recoverOutdatedApp(e)

      await vi.advanceTimersByTimeAsync(1000)
      await expect(done).resolves.toBe(false)
      expect(e.reload).not.toHaveBeenCalled()
    })

    it('업데이트 확인(sw.js 요청)이 멈추면 제한 시간 뒤 404 를 보인다', async () => {
      const reg = fakeRegistration()
      reg.update = () => new Promise(() => {})
      const done = recoverOutdatedApp(env({ getRegistration: async () => reg }))

      await vi.advanceTimersByTimeAsync(1000)
      await expect(done).resolves.toBe(false)
    })
  })

  it('저장 안 한 입력이 있으면 적용하지 않고 404 를 보인다(토스트가 사용자에게 맡긴다)', async () => {
    const { sw } = fakeSw('installed')
    const e = env({ hasUnsavedInput: () => true, waiting: sw })
    await expect(recoverOutdatedApp(e)).resolves.toBe(false)
    expect(sw.postMessage).not.toHaveBeenCalled()
  })

  it('적용 도중 화면을 떠났으면 새로고침은 건너뛴다(관리 SW 가 바뀐 창은 PwaUpdatePrompt 가 새로고침)', async () => {
    const { sw, moveTo } = fakeSw('installed')
    const controller = new AbortController()
    const e = env({ signal: controller.signal, waiting: sw })
    const done = recoverOutdatedApp(e)
    await flush()
    controller.abort()
    moveTo('activated')
    await done
    expect(e.reload).not.toHaveBeenCalled()
  })

  it('대기 중인 SW 가 더 새 SW 에 밀려 적용되지 않으면 기록하지 않아 다시 시도한다', async () => {
    const storage = memoryStorage()
    const first = fakeSw('installed')
    const done = recoverOutdatedApp(env({ storage, waiting: first.sw }))
    await flush()
    first.moveTo('redundant')
    await expect(done).resolves.toBe(false)

    const second = fakeSw('installed')
    void recoverOutdatedApp(env({ storage, waiting: second.sw }))
    await flush()
    expect(second.sw.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  it('업데이트를 확인해도 새 SW 가 없으면 404 를 보인다', async () => {
    const e = env()
    await expect(recoverOutdatedApp(e)).resolves.toBe(false)
    expect(e.reload).not.toHaveBeenCalled()
  })

  it.each([
    ['서버 버전이 지금과 같으면(진짜 없는 주소)', '0.9.14'],
    ['서버 버전을 읽지 못하면', null],
  ])('%s SW 를 건드리지 않고 404 를 보인다', async (_label, serverVersion) => {
    const getRegistration = vi.fn(async () => fakeRegistration())
    const e = env({ fetchServerVersion: async () => serverVersion, getRegistration })
    await expect(recoverOutdatedApp(e)).resolves.toBe(false)
    expect(getRegistration).not.toHaveBeenCalled()
  })

  it('확인하는 사이 404 화면을 떠났으면 적용·새로고침하지 않는다', async () => {
    const { sw } = fakeSw('installed')
    const controller = new AbortController()
    const e = env({
      signal: controller.signal,
      getRegistration: async () => {
        controller.abort()
        return fakeRegistration({ waiting: sw })
      },
    })
    await expect(recoverOutdatedApp(e)).resolves.toBe(false)
    expect(sw.postMessage).not.toHaveBeenCalled()
    expect(e.reload).not.toHaveBeenCalled()
  })

  it('업데이트 확인이 일시적으로 실패하면 기록하지 않아 다음에 다시 시도한다', async () => {
    const storage = memoryStorage()
    const reg = fakeRegistration({
      onUpdate: () => {
        throw new Error('offline')
      },
    })
    await expect(recoverOutdatedApp(env({ storage, getRegistration: async () => reg }))).resolves.toBe(false)

    const { sw, moveTo } = fakeSw('installed')
    const retry = env({ storage, waiting: sw })
    const done = recoverOutdatedApp(retry)
    await flush()
    moveTo('activated')
    await expect(done).resolves.toBe(true)
  })

  it('같은 주소·같은 서버 버전으로 한 번 적용했으면 되풀이하지 않는다', async () => {
    const storage = memoryStorage()
    const { sw, moveTo } = fakeSw('installed')
    const first = env({ storage, waiting: sw })
    const done = recoverOutdatedApp(first)
    await flush()
    moveTo('activated')
    await expect(done).resolves.toBe(true)

    // 새로고침한 뒤에도 404 면(새 버전에도 없는 주소) 대기 중인 SW 가 있어도 다시 적용하지 않는다.
    const stillWaiting = fakeSw('installed')
    const again = env({ storage, waiting: stillWaiting.sw })
    await expect(recoverOutdatedApp(again)).resolves.toBe(false)
    expect(stillWaiting.sw.postMessage).not.toHaveBeenCalled()

    // 다음 배포에서는 다시 시도한다.
    const next = fakeSw('installed')
    const nextDeploy = env({
      storage,
      fetchServerVersion: async () => '0.9.16',
      waiting: next.sw,
    })
    void recoverOutdatedApp(nextDeploy)
    await flush()
    expect(next.sw.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })
})
