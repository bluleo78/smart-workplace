// @vitest-environment jsdom
import { act, Activity, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 훅 배선(세션 보유·5초 오프라인 경계·서버 역할 반영)만 검증한다 — provider 는 이벤트만 흉내 내는 가짜.
vi.mock('@hocuspocus/provider', () => {
  class FakeProvider {
    configuration: { name: string }
    unsyncedChanges = 0
    isAuthenticated = false
    isSynced = false
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    constructor(config: { name: string }) {
      this.configuration = config
    }
    get hasUnsyncedChanges() {
      return this.unsyncedChanges > 0
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set())
      this.listeners.get(event)!.add(fn)
      return this
    }
    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((fn) => fn(...args))
    }
    disconnect() {}
    async connect() {}
    destroyed = false
    destroy() {
      this.destroyed = true
      this.listeners.clear()
    }
  }
  return { HocuspocusProvider: FakeProvider }
})
vi.mock('../api/client', () => ({ getAccessToken: () => 't', refreshAccessTokenOutcome: async () => 'ok' }))

import { type CollabSession, resetCollabSessionsForTest } from '@/lib/collab/collabSession'

import { useCollabSession } from './useCollabSession'

type Fake = { isAuthenticated: boolean; isSynced: boolean; emit: (e: string, ...a: unknown[]) => void }
const fake = (s: CollabSession) => s.provider as unknown as Fake

type Result = ReturnType<typeof useCollabSession>
let last: Result
const record = (r: Result) => {
  last = r
}
/** 훅 결과를 렌더마다 밖으로 넘기는 프로브 컴포넌트. */
function Probe({ pageId, readOnly, onResult }: { pageId: number; readOnly: boolean; onResult: (r: Result) => void }) {
  const result = useCollabSession(pageId, { readOnly })
  useEffect(() => onResult(result))
  return null
}

describe('useCollabSession', () => {
  let root: Root
  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    root = createRoot(document.createElement('div'))
  })
  afterEach(() => {
    act(() => root.unmount())
    resetCollabSessionsForTest()
    vi.useRealTimers()
  })

  const render = (pageId: number, readOnly = false) =>
    act(() => root.render(createElement(Probe, { pageId, readOnly, onResult: record })))

  function goLive(s: CollabSession) {
    act(() => {
      fake(s).isAuthenticated = true
      fake(s).emit('authenticated', { scope: 'read-write' })
      fake(s).isSynced = true
      fake(s).emit('synced', { state: true })
    })
  }

  // 새 세션은 첫 동기화 전까지 본문을 보이지 않고(body≠ready) 중립 '연결 중' — 화면 역할이 아직 읽기 전용이어도.
  it('is connecting and not ready until the first sync, then stays ready across a drop', () => {
    render(5, true)
    const s = last.session
    expect(last).toMatchObject({ status: 'connecting', body: 'loading' })
    goLive(s)
    expect(last).toMatchObject({ status: 'live', body: 'ready' })
    act(() => fake(s).emit('disconnect', { event: { code: 1006, reason: '' } }))
    expect(last).toMatchObject({ status: 'reconnecting', body: 'ready' })
  })

  it('reuses an already synced session as ready with no connecting phase', () => {
    render(6)
    goLive(last.session)
    act(() => root.unmount())
    root = createRoot(document.createElement('div'))
    const seen: Result[] = []
    act(() => root.render(createElement(Probe, { pageId: 6, readOnly: false, onResult: (r) => { seen.push(r) } })))
    expect(seen.every((r) => r.body === 'ready')).toBe(true)
    expect(seen[0].status).toBe('live')
  })

  it('shows reconnecting below 5s and offline from 5s after a drop', () => {
    render(1)
    const s = last.session
    goLive(s)
    expect(last.status).toBe('live')
    act(() => fake(s).emit('disconnect', { event: { code: 1006, reason: '' } }))
    expect(last.status).toBe('reconnecting')
    act(() => vi.advanceTimersByTime(4999))
    expect(last.status).toBe('reconnecting')
    act(() => vi.advanceTimersByTime(1))
    expect(last.status).toBe('offline')
    // 다시 붙었다가 또 끊기면 새 끊김 기준으로 다시 센다
    goLive(s)
    expect(last.status).toBe('live')
    act(() => fake(s).emit('disconnect', { event: { code: 1006, reason: '' } }))
    expect(last.status).toBe('reconnecting')
  })

  it('follows server role changes over the readOnly prop', () => {
    render(2, false)
    const s = last.session
    goLive(s)
    expect(last.readOnly).toBe(false)
    act(() => fake(s).emit('stateless', { payload: '{"type":"collab:role","role":"VIEWER"}' }))
    expect(last).toMatchObject({ readOnly: true, status: 'readonly' })
    act(() => fake(s).emit('stateless', { payload: '{"type":"collab:role","role":"EDITOR"}' }))
    expect(last).toMatchObject({ readOnly: false, status: 'live' })
  })

  it('reports forbidden as terminal and read-only', () => {
    render(3)
    act(() => fake(last.session).emit('disconnect', { event: { code: 4403, reason: 'forbidden' } }))
    expect(last).toMatchObject({ status: 'forbidden', readOnly: true })
  })

  it('reports deleted as terminal and read-only', () => {
    render(7)
    act(() => fake(last.session).emit('disconnect', { event: { code: 4404, reason: 'deleted' } }))
    expect(last).toMatchObject({ status: 'deleted', readOnly: true })
  })

  it('reuses the same session across a remount within the grace period', () => {
    render(4)
    const first = last.session
    act(() => root.unmount())
    root = createRoot(document.createElement('div'))
    act(() => vi.advanceTimersByTime(3000))
    render(4)
    expect(last.session).toBe(first)
  })

  // 숨겨진 화면(Activity hidden)은 effect 가 정리돼 세션을 놓는다. 유예가 지나 세션이 정리된 뒤 다시 보이면
  // 죽은 provider 를 계속 쥐지 않고 같은 페이지의 살아 있는 세션으로 갈아탄다.
  it('switches to a live session when re-shown after its session was destroyed', () => {
    const show = (mode: 'visible' | 'hidden') =>
      act(() =>
        root.render(
          createElement(Activity, {
            mode,
            children: createElement(Probe, { pageId: 8, readOnly: false, onResult: record }),
          }),
        ),
      )
    show('visible')
    const first = last.session
    show('hidden')
    act(() => vi.advanceTimersByTime(5001))
    expect((first.provider as unknown as { destroyed: boolean }).destroyed).toBe(true)
    show('visible')
    expect(last.session).not.toBe(first)
    expect((last.session.provider as unknown as { destroyed: boolean }).destroyed).toBe(false)
    // 새 세션은 보유 중이라 유예가 지나도 살아 있고 동기화되면 ready
    act(() => vi.advanceTimersByTime(10_000))
    expect((last.session.provider as unknown as { destroyed: boolean }).destroyed).toBe(false)
    goLive(last.session)
    expect(last).toMatchObject({ status: 'live', body: 'ready' })
  })

  // WP-173 — 원격 커서·아바타 흐림은 "한 번 동기화된 뒤 끊겨 있는 동안"만. 첫 연결 전·종단은 흐림이 아니다.
  it('reports stale only while a synced session is disconnected', () => {
    render(31)
    const s = last.session
    expect(last.stale).toBe(false)
    goLive(s)
    expect(last.stale).toBe(false)
    act(() => fake(s).emit('disconnect', { event: { code: 1006, reason: '' } }))
    expect(last.stale).toBe(true)
    act(() => fake(s).emit('disconnect', { event: { code: 4403, reason: 'forbidden' } }))
    expect(last).toMatchObject({ status: 'forbidden', stale: false })
  })

  // 첫 동기화를 못 한 채(동기화 서버 장애·인증 불러오기 실패) 5초가 지나면 skeleton 대신 안내 — 붙으면 본문으로.
  it('turns a never-synced body into the unreachable notice after 5s, then shows the body on sync', () => {
    render(9)
    expect(last).toMatchObject({ status: 'connecting', body: 'loading' })
    act(() => vi.advanceTimersByTime(4999))
    expect(last.body).toBe('loading')
    act(() => vi.advanceTimersByTime(1))
    expect(last).toMatchObject({ status: 'offline', body: 'unreachable' })
    goLive(last.session)
    expect(last).toMatchObject({ status: 'live', body: 'ready' })
  })
})

