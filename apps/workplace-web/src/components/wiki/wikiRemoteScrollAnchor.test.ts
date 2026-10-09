import type { Transaction } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { ySyncPluginKey } from 'y-prosemirror'

import { isRemoteSync, isRemoteSyncTr } from './wikiCollabPosition'

describe('isRemoteSync', () => {
  it('is true only for a Yjs → PM change that is not my own undo/redo', () => {
    expect(isRemoteSync({ isChangeOrigin: true })).toBe(true)
    expect(isRemoteSync({ isChangeOrigin: true, isUndoRedoOperation: false })).toBe(true)
    // 내 실행 취소도 y-prosemirror 가 isChangeOrigin 으로 반영한다 — 이건 내 입력이라 선택 위치로 스크롤해야 한다.
    expect(isRemoteSync({ isChangeOrigin: true, isUndoRedoOperation: true })).toBe(false)
    expect(isRemoteSync({ isChangeOrigin: false })).toBe(false)
    expect(isRemoteSync(undefined)).toBe(false)
  })
})

/** getMeta 만 흉내 낸 가짜 트랜잭션 — ySync 메타와 appendedTransaction(덧붙은 트랜잭션의 원래 트랜잭션)만 쓴다. */
const fakeTr = (metas: Map<unknown, unknown>) => ({ getMeta: (k: unknown) => metas.get(k) }) as unknown as Transaction

describe('isRemoteSyncTr', () => {
  it('follows an appended transaction back to its root', () => {
    const remoteRoot = fakeTr(new Map([[ySyncPluginKey, { isChangeOrigin: true }]]))
    const undoRoot = fakeTr(new Map([[ySyncPluginKey, { isChangeOrigin: true, isUndoRedoOperation: true }]]))
    expect(isRemoteSyncTr(remoteRoot)).toBe(true)
    // 원격 반영 뒤 다른 플러그인(링크 자동 감지 등)이 덧붙인 트랜잭션도 원격이다.
    expect(isRemoteSyncTr(fakeTr(new Map([['appendedTransaction', remoteRoot]])))).toBe(true)
    // 내 실행 취소 뒤 덧붙은 것은 내 입력이다.
    expect(isRemoteSyncTr(fakeTr(new Map([['appendedTransaction', undoRoot]])))).toBe(false)
    expect(isRemoteSyncTr(fakeTr(new Map()))).toBe(false)
  })
})
