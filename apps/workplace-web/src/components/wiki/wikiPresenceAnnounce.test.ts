import type { HocuspocusProvider } from '@hocuspocus/provider'
import { describe, expect, it } from 'vitest'

import { announcePresence } from './wikiPresenceAnnounce'

/** awareness·provider 최소 흉내 — 로컬 상태와 synced 이벤트만(wikiAiPresence.test 와 같은 모양). */
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
  return { provider: provider as unknown as HocuspocusProvider, awareness, emit }
}

const me = { id: 1, name: '테스트 사용자' }

describe('announcePresence', () => {
  it('puts my user next to other awareness fields and clears only it when done', () => {
    const { provider, awareness } = fakeProvider()
    awareness.state = { aiMarkers: null }
    const stop = announcePresence(provider, me)
    expect(awareness.state).toEqual({ aiMarkers: null, user: me })
    stop()
    expect(awareness.state).toEqual({ aiMarkers: null, user: null })
  })

  it('re-puts after the provider cleared my state (pagehide · reconnect)', () => {
    const { provider, awareness, emit } = fakeProvider()
    const stop = announcePresence(provider, me)
    awareness.state = null
    emit('synced')
    expect(awareness.state).toEqual({ user: me })
    stop()
    awareness.state = null
    emit('synced')
    expect(awareness.state).toBeNull()
  })

  it('does not revive a removed state on cleanup and is safe to call twice', () => {
    const { provider, awareness } = fakeProvider()
    const stop = announcePresence(provider, me)
    awareness.state = null
    stop()
    stop()
    expect(awareness.state).toBeNull()
  })
})
