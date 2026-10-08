import type { HocuspocusProvider } from '@hocuspocus/provider'
import { describe, expect, it } from 'vitest'

import { announceAiWriting } from './wikiAiPresence'

/** awareness·provider 최소 흉내 — 로컬 상태와 synced 이벤트만. */
function fakeProvider() {
  const awareness = {
    state: {} as Record<string, unknown> | null,
    getLocalState() {
      return this.state
    },
    setLocalState(s: Record<string, unknown> | null) {
      this.state = s
    },
  }
  const handlers = new Map<string, Set<() => void>>()
  const provider = {
    awareness,
    on(e: string, f: () => void) {
      if (!handlers.has(e)) handlers.set(e, new Set())
      handlers.get(e)!.add(f)
    },
    off(e: string, f: () => void) {
      handlers.get(e)?.delete(f)
    },
  }
  const emit = (e: string) => handlers.get(e)?.forEach((f) => f())
  return { provider: provider as unknown as HocuspocusProvider, awareness, emit, handlers }
}

const who = { userId: 1, name: '테스트 사용자' }
const anchor = { type: null, tname: 'default', item: null, assoc: 0 }

describe('announceAiWriting', () => {
  it('puts my marker next to other awareness fields and clears it when done', () => {
    const { provider, awareness } = fakeProvider()
    awareness.state = { user: { name: 'x' } }
    const done = announceAiWriting(provider, who, anchor)
    expect(awareness.state).toMatchObject({ user: { name: 'x' }, aiMarkers: [{ userId: 1, name: '테스트 사용자', anchor }] })
    done()
    expect(awareness.state).toEqual({ user: { name: 'x' }, aiMarkers: null })
  })

  it('puts the marker back after a reconnect cleared my state (pagehide/close)', () => {
    const { provider, awareness, emit } = fakeProvider()
    const done = announceAiWriting(provider, who, anchor)
    awareness.state = null // provider 가 pagehide 에서 내 상태를 지움
    emit('synced')
    expect(awareness.state).toMatchObject({ aiMarkers: [{ name: '테스트 사용자' }] })
    done()
    awareness.state = null
    emit('synced') // 끝난 뒤의 재접속은 다시 올리지 않는다
    expect(awareness.state).toBeNull()
  })

  it('is safe to call the cleanup twice', () => {
    const { provider, awareness } = fakeProvider()
    const done = announceAiWriting(provider, who, anchor)
    done()
    awareness.state = { other: 1 }
    done()
    expect(awareness.state).toEqual({ other: 1 })
  })

  it('does not revive a state the provider already removed (destroy/pagehide) when cleaning up', () => {
    const { provider, awareness, handlers } = fakeProvider()
    const done = announceAiWriting(provider, who, anchor)
    awareness.state = null // 화면을 떠나며 provider 가 내 상태를 지운 뒤에 정리가 불린다
    done()
    expect(awareness.state).toBeNull()
    expect(handlers.get('synced')?.size ?? 0).toBe(0)
  })

  it('keeps the same marker id across a re-put so receivers treat it as one marker', () => {
    const { provider, awareness, emit } = fakeProvider()
    announceAiWriting(provider, who, anchor)
    const first = (awareness.state!.aiMarkers as { id: string }[])[0].id
    awareness.state = null
    emit('synced')
    expect((awareness.state!.aiMarkers as { id: string }[])[0].id).toBe(first)
  })
})
