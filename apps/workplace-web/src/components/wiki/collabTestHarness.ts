import type { Editor } from '@tiptap/core'
import * as Y from 'yjs'

/**
 * 노트 동시 편집 단위 테스트 공용(jsdom) — 동기화 서버 없이 두 Y.Doc 을 잇고, 확장이 쓰는 awareness 면만 흉내 낸다.
 * wikiAiMarkers.test 에서 꺼냈다(WP-173 커서 테스트가 같은 도구를 쓴다). vitest include(*.test.ts) 밖이라 테스트로 돌지 않는다.
 */

/** 두 Y.Doc 을 서로 동기화한다(동기화 서버 대신). */
export function link(a: Y.Doc, b: Y.Doc): void {
  a.on('update', (u: Uint8Array, origin: unknown) => origin !== b && Y.applyUpdate(b, u, a))
  b.on('update', (u: Uint8Array, origin: unknown) => origin !== a && Y.applyUpdate(a, u, b))
}

type Changes = { added: number[]; updated: number[]; removed: number[] }

/**
 * awareness 흉내 — clientID·getStates·getLocalState·setLocalState·on/off. set 으로 다른 접속자 상태를 바꾸고
 * y-protocols 처럼 바뀐 접속자를 added·updated·removed 로 알린다. 내 상태도 같은 Map 의 clientID 칸에 둔다.
 */
export function fakeAwareness(clientID: number) {
  const states = new Map<number, Record<string, unknown>>()
  const listeners = new Set<(changes: Changes) => void>()
  const set = (clientId: number, state: Record<string, unknown> | null) => {
    const had = states.has(clientId)
    if (state) states.set(clientId, state)
    else states.delete(clientId)
    const changes: Changes = { added: [], updated: [], removed: [] }
    if (!state) changes.removed.push(clientId)
    else (had ? changes.updated : changes.added).push(clientId)
    listeners.forEach((fn) => fn(changes))
  }
  return {
    clientID,
    getStates: () => states,
    getLocalState: () => states.get(clientID) ?? null,
    setLocalState: (s: Record<string, unknown> | null) => set(clientID, s),
    on: (_e: 'change', fn: (changes: Changes) => void) => listeners.add(fn),
    off: (_e: 'change', fn: (changes: Changes) => void) => listeners.delete(fn),
    set,
  }
}

/** 문서에서 글자 text 가 시작하는 위치. */
export function startOf(editor: Editor, text: string): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return
    const idx = node.text!.indexOf(text)
    if (idx >= 0) found = pos + idx
  })
  if (found < 0) throw new Error(`no "${text}"`)
  return found
}
