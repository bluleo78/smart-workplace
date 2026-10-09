import { describe, expect, it } from 'vitest'

import {
  type AwarenessChangeListener,
  type AwarenessChanges,
  createPresenceAwareness,
  presenceAwarenessOf,
} from './presenceAwareness'

// 끊긴 동안 마지막 접속자 상태를 붙잡는 덮개(WP-173 판정 11). @hocuspocus/provider 4.7.0 의 onClose 는 synced 를 false 로 내린 뒤
// 나를 뺀 원격 상태를 origin = provider 로 지운다 — 아래 흉내(fakeProvider.close)는 그 순서를 그대로 재현한다.

const SELF = 100
const ME = { user: { id: 1, name: '나' } }
const KIM = { user: { id: 2, name: '김철수' } }
const LEE = { user: { id: 3, name: '이영희' } }

/** y-protocols Awareness 의 필요한 면 — put·remove 로 origin 을 지정해 change 를 낸다(y-protocols 와 같은 added·updated·removed). */
function fakeAwareness() {
  const states = new Map<number, Record<string, unknown>>()
  /** y-protocols 의 접속자별 clock — 같은 clock 의 재전송을 무시하는 근거(덮개가 붙잡을 때 지워야 한다). */
  const meta = new Map<number, { clock: number }>()
  const fns = new Set<AwarenessChangeListener>()
  const emit = (c: AwarenessChanges, origin: unknown) => fns.forEach((f) => f(c, origin))
  const put = (id: number, st: Record<string, unknown>, origin: unknown) => {
    const had = states.has(id)
    states.set(id, st)
    meta.set(id, { clock: (meta.get(id)?.clock ?? 0) + 1 })
    emit({ added: had ? [] : [id], updated: had ? [id] : [], removed: [] }, origin)
  }
  const remove = (ids: number[], origin: unknown) => {
    const removed = ids.filter((id) => states.delete(id))
    if (removed.length > 0) emit({ added: [], updated: [], removed }, origin)
  }
  return {
    clientID: SELF,
    meta,
    getStates: () => states,
    getLocalState: () => states.get(SELF) ?? null,
    setLocalState: (st: Record<string, unknown> | null) => (st ? put(SELF, st, 'local') : remove([SELF], 'local')),
    on: (_e: 'change', f: AwarenessChangeListener) => void fns.add(f),
    off: (_e: 'change', f: AwarenessChangeListener) => void fns.delete(f),
    put,
    remove,
  }
}

/** provider 의 필요한 면 — isSynced 와 synced 이벤트. */
function fakeProvider() {
  const onSynced = new Set<() => void>()
  const provider = {
    isSynced: true,
    on: (_e: 'synced', f: () => void) => void onSynced.add(f),
    /** HocuspocusProvider.onClose 흉내 — synced 를 먼저 내리고 나를 뺀 원격 상태를 origin = provider 로 지운다. */
    close(aw: ReturnType<typeof fakeAwareness>) {
      provider.isSynced = false
      aw.remove([...aw.getStates().keys()].filter((id) => id !== SELF), provider)
    },
    /** 다시 붙어 동기화를 마쳤다. */
    resync() {
      provider.isSynced = true
      onSynced.forEach((f) => f())
    },
  }
  return provider
}

/** 나·김철수(201)·이영희(301)가 붙어 동기화된 상태. events 는 덮개 구독자가 받은 change. */
function setup() {
  const aw = fakeAwareness()
  const provider = fakeProvider()
  const presence = createPresenceAwareness(aw, provider)
  const events: AwarenessChanges[] = []
  presence.on('change', (c) => events.push(c))
  aw.put(SELF, ME, 'local')
  aw.put(201, KIM, provider)
  aw.put(301, LEE, provider)
  events.length = 0
  return { aw, provider, presence, events }
}

describe('createPresenceAwareness', () => {
  it('keeps the last states the provider dropped on close, without telling listeners', () => {
    const { aw, provider, presence, events } = setup()
    provider.close(aw)
    expect(aw.getStates().has(201)).toBe(false)
    expect(presence.getStates().get(201)).toEqual(KIM)
    expect(presence.getStates().get(301)).toEqual(LEE)
    expect(presence.holding).toBe(true)
    expect(events).toEqual([])
  })

  it("forgets a held client's clock so the server's unchanged re-send after reconnect counts as a new arrival", () => {
    const { aw, provider } = setup()
    provider.close(aw)
    // y-protocols applyAwarenessUpdate 는 clock 이 같으면 무시한다 — 남겨 두면 다시 붙어도 김철수가 다음 갱신(15초)까지 돌아오지 않는다.
    expect(aw.meta.has(201)).toBe(false)
    expect(aw.meta.has(301)).toBe(false)
    expect(aw.meta.has(SELF)).toBe(true)
  })

  it('lets the held states go on the next sync, live values winning, and reports only the gone ones', () => {
    const { aw, provider, presence, events } = setup()
    provider.close(aw)
    aw.put(201, KIM, provider) // 다시 붙자 서버가 김철수 상태를 보냈다 — 살아 있는 값이 붙잡은 값을 대신한다
    provider.resync()
    expect([...presence.getStates().keys()].sort()).toEqual([SELF, 201])
    expect(presence.holding).toBe(false)
    // 붙잡아 계속 보이던 김철수의 재전송은 구독자에겐 "새로 들어옴" 이 아니라 갱신이다(이미 보이는 id 에 added 를 두 번 내지 않는다).
    expect(events).toEqual([
      { added: [], updated: [201], removed: [] },
      { added: [], updated: [], removed: [301] },
    ])
  })

  it('passes a real leave (sent by the server while synced) and a timeout straight through', () => {
    const { aw, provider, presence, events } = setup()
    aw.remove([201], provider)
    aw.remove([301], 'timeout')
    expect([...presence.getStates().keys()]).toEqual([SELF])
    expect(presence.holding).toBe(false)
    expect(events).toEqual([
      { added: [], updated: [], removed: [201] },
      { added: [], updated: [], removed: [301] },
    ])
  })

  it('never holds my own state (pagehide)', () => {
    const { aw, presence } = setup()
    aw.remove([SELF], 'page hide')
    expect(presence.getLocalState()).toBeNull()
    expect(presence.getStates().has(SELF)).toBe(false)
  })

  it('drop() forgets the held states at once (terminal) and reports them removed', () => {
    const { aw, provider, presence, events } = setup()
    provider.close(aw)
    presence.drop()
    expect([...presence.getStates().keys()]).toEqual([SELF])
    expect(presence.holding).toBe(false)
    expect(events).toEqual([{ added: [], updated: [], removed: [201, 301] }])
  })

  it('stays dropped — a close that arrives after drop() (disconnect closes the socket later) is not held', () => {
    const { aw, provider, presence, events } = setup()
    presence.drop()
    provider.close(aw)
    expect([...presence.getStates().keys()]).toEqual([SELF])
    expect(presence.holding).toBe(false)
    expect(events).toEqual([{ added: [], updated: [], removed: [201, 301] }])
  })

  it('reads and writes my local state on the live awareness', () => {
    const { aw, presence } = setup()
    expect(presence.clientID).toBe(SELF)
    presence.setLocalState({ ...ME, cursor: null })
    expect(aw.getLocalState()).toEqual({ ...ME, cursor: null })
    expect(presence.getLocalState()).toBe(aw.getLocalState())
  })
})

describe('presenceAwarenessOf', () => {
  it('returns one wrapper per provider, and null without awareness', () => {
    const provider = Object.assign(fakeProvider(), { awareness: fakeAwareness() })
    const w = presenceAwarenessOf(provider as never)
    expect(w).not.toBeNull()
    expect(presenceAwarenessOf(provider as never)).toBe(w)
    expect(presenceAwarenessOf(Object.assign(fakeProvider(), { awareness: null }) as never)).toBeNull()
  })
})
