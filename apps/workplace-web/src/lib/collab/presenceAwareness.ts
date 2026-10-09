import type { HocuspocusProvider } from '@hocuspocus/provider'

/**
 * 끊긴 동안의 접속자(WP-173, 스펙 §7.1 ② "재연결 중 원격 커서 흐리게") — 실제 awareness 위에 "끊기기 직전 마지막으로 본 다른
 * 접속자 상태" 를 겹친 덮개. 헤더 아바타(usePresence)·원격 커서(WikiPresenceCursors)·✦ 표식(WikiAiMarkers)이 이것을 읽는다.
 *
 * @hocuspocus/provider 4.7.0 의 HocuspocusProvider.onClose() 는 소켓 종료(또는 문서 CLOSE 메시지) 때 synced 를 false 로 내린 뒤
 * 나를 뺀 모든 원격 상태를 removeAwarenessStates(…, origin = provider) 로 지운다. 그대로 두면 끊기는 순간 아바타·커서·✦ 가 사라져
 * 흐리게 보일 것이 없다. 그래서 그 일괄 제거만 붙잡아 두고 다음 synced(재연결 후 새 동기화) 때 놓는다.
 * - 판별: 제거 + origin === provider + !provider.isSynced. 실제로 나간 사람은 서버가 알린 제거라 origin 은 같아도 동기화된 채로 온다.
 *   30초 만료('timeout')·내 상태 제거(pagehide)는 붙잡지 않는다.
 * - 세션 connected·React stale 로 판별하지 않는다 — 문서 CLOSE 경로에선 onClose 가 세션의 close 처리보다 먼저 돌아 아직 '연결 중' 이다.
 * - 붙잡을 때 그 접속자의 meta(clock)를 지운다 — applyAwarenessUpdate 는 clock 이 같은 상태를 무시하므로, 남겨 두면 재연결 뒤 서버가
 *   다시 보낸 변함없는 상태가 버려져 synced 에 놓인 사람이 다음 갱신(약 15초)까지 사라진다. 지우면 그 재전송이 added 로 들어온다.
 * - 붙잡은 제거는 구독자에게 전하지 않는다(커서 확장이 이름표 시계를 지우지 않게). 놓을 때 한 번에 removed 로 알린다.
 * - 종단(권한 없음·삭제 등)은 다시 동기화되지 않으므로 화면이 drop() 으로 버린다. drop() 은 영구다 — stopTerminal 의 disconnect() 는
 *   소켓을 닫기만 해 onClose 일괄 제거가 나중 태스크에 올 수 있는데, 그것까지 붙잡으면 ✦ 표식이 종단 뒤에도 남는다.
 * 내 상태 읽기·쓰기(getLocalState·setLocalState)는 실제 awareness 그대로다.
 */

export type AwarenessChanges = { added: number[]; updated: number[]; removed: number[] }
export type AwarenessChangeListener = (changes: AwarenessChanges, origin: unknown) => void

/** 접속자 화면이 쓰는 awareness 면 — y-protocols Awareness 도 이 모양을 만족한다(그래서 실제 awareness 를 그대로 넘겨도 된다). */
export interface PresenceAwareness {
  readonly clientID: number
  getStates(): Map<number, Record<string, unknown>>
  getLocalState(): Record<string, unknown> | null
  setLocalState(state: Record<string, unknown> | null): void
  on(event: 'change', fn: AwarenessChangeListener): void
  off(event: 'change', fn: AwarenessChangeListener): void
}

export interface HeldPresenceAwareness extends PresenceAwareness {
  /** 끊긴 동안의 상태를 붙잡고 있는지. */
  readonly holding: boolean
  /** 붙잡은 상태를 바로 버리고, 이후로는 붙잡지 않는다 — 종단(다시 동기화되지 않음). */
  drop(): void
}

export function createPresenceAwareness(
  // meta: y-protocols Awareness 의 접속자별 clock 표(있으면 붙잡을 때 지운다 — 머리 주석).
  awareness: PresenceAwareness & { meta?: Map<number, unknown> },
  provider: { readonly isSynced: boolean; on(event: 'synced', fn: () => void): unknown },
): HeldPresenceAwareness {
  const listeners = new Set<AwarenessChangeListener>()
  /** 종단으로 버렸다 — 이후엔 아무것도 붙잡지 않는다. */
  let ended = false
  /** 다른 접속자의 마지막 상태 — 지워진 뒤엔 값을 읽을 수 없어 change 마다 적어 둔다. */
  const lastSeen = new Map<number, Record<string, unknown>>()
  /** 연결 종료로 지워졌지만 다시 동기화될 때까지 보여 줄 상태. */
  const held = new Map<number, Record<string, unknown>>()
  const emit = (changes: AwarenessChanges, origin: unknown) => listeners.forEach((fn) => fn(changes, origin))
  const remember = (id: number) => {
    const st = awareness.getStates().get(id)
    if (id !== awareness.clientID && st) lastSeen.set(id, st)
  }
  for (const id of awareness.getStates().keys()) remember(id)

  awareness.on('change', (changes, origin) => {
    // 붙잡아 계속 보이던 접속자의 재전송은 구독자에겐 갱신이다 — 이미 보이는 id 에 added 를 다시 내지 않는다(구독자가 중복 등록하지 않게).
    const added: number[] = []
    const updated = [...changes.updated]
    for (const id of changes.added) (held.has(id) ? updated : added).push(id)
    const live = [...changes.added, ...changes.updated]
    for (const id of live) {
      remember(id)
      held.delete(id) // 다시 들어온 접속자는 살아 있는 값이 이긴다
    }
    // onClose 일괄 정리인지 — 판별 근거는 머리 주석.
    const dropped = !ended && origin === provider && !provider.isSynced
    const removed: number[] = []
    for (const id of changes.removed) {
      const last = lastSeen.get(id)
      lastSeen.delete(id)
      if (dropped && last) {
        held.set(id, last)
        awareness.meta?.delete(id) // 재연결 뒤 같은 clock 재전송이 버려지지 않게
      } else {
        held.delete(id)
        removed.push(id)
      }
    }
    if (live.length > 0 || removed.length > 0) emit({ added, updated, removed }, origin)
  })

  /** 붙잡은 상태를 놓고 removed 로 알린다. */
  const release = (origin: unknown) => {
    if (held.size === 0) return
    const ids = [...held.keys()]
    held.clear()
    emit({ added: [], updated: [], removed: ids }, origin)
  }
  // 다시 붙어 동기화를 마쳤다 — 서버가 지금 접속자를 다시 보내므로 붙잡은 값은 필요 없다.
  provider.on('synced', () => release(provider))

  return {
    get clientID() {
      return awareness.clientID
    },
    getStates: () => {
      const states = awareness.getStates()
      if (held.size === 0) return states
      const merged = new Map(held)
      for (const [id, st] of states) merged.set(id, st)
      return merged
    },
    getLocalState: () => awareness.getLocalState(),
    setLocalState: (state) => awareness.setLocalState(state),
    on: (_event, fn) => {
      listeners.add(fn)
    },
    off: (_event, fn) => {
      listeners.delete(fn)
    },
    get holding() {
      return held.size > 0
    },
    drop: () => {
      ended = true
      release('terminal')
    },
  }
}

/** provider 별 덮개 — 헤더·커서·✦ 가 같은 것을 읽어야 해서 provider 하나에 하나만 만든다(StrictMode 이중 렌더에도 구독은 한 번). */
const wrappers = new WeakMap<HocuspocusProvider, HeldPresenceAwareness>()

/**
 * 이 provider 의 접속자 덮개 — 동기화 꺼짐(awareness 없음)이면 null. 렌더 중 불러도 된다(멱등, 수명은 provider 와 같아 해지가 없다).
 * 끊기기 전에 처음 불려야 마지막 상태를 적어 둘 수 있다 — WikiEditor 가 첫 렌더에서 부른다(세션 연결은 그 뒤 비동기).
 */
export function presenceAwarenessOf(provider: HocuspocusProvider): HeldPresenceAwareness | null {
  const awareness = provider.awareness
  if (!awareness) return null
  let w = wrappers.get(provider)
  if (!w) {
    w = createPresenceAwareness(awareness, provider)
    wrappers.set(provider, w)
  }
  return w
}
