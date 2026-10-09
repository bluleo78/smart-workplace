import { useMemo, useSyncExternalStore } from 'react'

import { type AwarenessStates, derivePeople, peopleSignature, type PresencePerson } from '@/lib/collab/presence'
import type { PresenceAwareness } from '@/lib/collab/presenceAwareness'

const EMPTY: PresencePerson[] = []

/**
 * 접속자 목록 외부 저장소(useSyncExternalStore 용) — awareness 가 바뀐 뒤 처음 읽을 때만 다시 계산하고, 목록 모양이 같으면 같은 배열을 돌려준다.
 * getSnapshot 은 렌더마다 불리므로 매번 derivePeople 을 돌리지 않는다. 처음엔 더러운 상태로 시작하고, 구독할 때도 한 번 더럽힌다 —
 * 렌더(읽기)와 구독 사이에 온 변경을 놓치지 않게(React 가 구독 직후 다시 읽어 비교한다).
 * 비교용 캐시를 바꿔 써야 해서 훅 밖 일반 함수로 둔다(React Compiler 는 훅 안 클로저의 재할당을 렌더 밖 변경으로 막는다).
 */
function createPresenceStore(awareness: PresenceAwareness | null, selfUserId: number | null) {
  let cache: { sig: string; people: PresencePerson[] } = { sig: '', people: EMPTY }
  let dirty = true
  const read = (): PresencePerson[] => {
    if (!awareness) return EMPTY
    if (!dirty) return cache.people
    dirty = false
    const people = derivePeople(awareness.getStates() as AwarenessStates, { clientId: awareness.clientID, userId: selfUserId })
    const sig = peopleSignature(people)
    if (sig !== cache.sig) cache = { sig, people: people.length > 0 ? people : EMPTY }
    return cache.people
  }
  const subscribe = (onChange: () => void) => {
    if (!awareness) return () => {}
    dirty = true
    const listener = () => {
      dirty = true
      onChange()
    }
    awareness.on('change', listener)
    return () => awareness.off('change', listener)
  }
  return { read, subscribe }
}

/**
 * 노트 접속자 목록 구독(WP-173) — awareness 가 바뀔 때마다 다시 계산하되, 목록 모양(사람·상태)이 같으면 같은 배열을 돌려준다.
 * awareness 는 커서 이동마다 바뀌므로 비교 키(peopleSignature)로 헤더가 매 타이핑마다 다시 그려지지 않게 한다.
 * 실제 awareness 대신 presenceAwarenessOf 덮개를 받는다 — 끊긴 동안에도 마지막 접속자를 (흐리게) 보이기 위해(판정 11).
 */
export function usePresence(awareness: PresenceAwareness | null, selfUserId: number | null): PresencePerson[] {
  const store = useMemo(() => createPresenceStore(awareness, selfUserId), [awareness, selfUserId])
  return useSyncExternalStore(store.subscribe, store.read, () => EMPTY)
}
