import { describe, expect, it } from 'vitest'

import { acceptResume, advancedClients, AWAY_TOAST_MS, countAwayEditors, shouldShowAwayToast } from './collabResume'

describe('advancedClients', () => {
  it('lists clients whose clock moved forward, including new ones', () => {
    const before = new Map([
      [1, 5],
      [2, 3],
    ])
    const after = new Map([
      [1, 5],
      [2, 4],
      [3, 1],
    ])
    expect(advancedClients(before, after).sort()).toEqual([2, 3])
  })
})

describe('countAwayEditors', () => {
  const known = new Map([
    [10, 1], // 나
    [11, 1], // 내 다른 탭
    [20, 2], // 김철수 탭 1
    [21, 2], // 김철수 탭 2
  ])
  it('counts one person once and skips me and my other tab', () => {
    expect(countAwayEditors([10, 11, 20, 21], known, { clientId: 10, userId: 1 })).toBe(1)
  })
  it('counts each unknown client (joined and left while away, server AI apply) as one person', () => {
    expect(countAwayEditors([20, 99, 98], known, { clientId: 10, userId: 1 })).toBe(3)
  })
})

describe('shouldShowAwayToast', () => {
  it('needs more than two minutes away and at least one other editor', () => {
    expect(shouldShowAwayToast(null)).toBe(false)
    expect(shouldShowAwayToast({ seq: 1, awayMs: AWAY_TOAST_MS, editors: 2 })).toBe(false)
    expect(shouldShowAwayToast({ seq: 1, awayMs: AWAY_TOAST_MS + 1, editors: 0 })).toBe(false)
    expect(shouldShowAwayToast({ seq: 1, awayMs: AWAY_TOAST_MS + 1, editors: 1 })).toBe(true)
  })
})

describe('acceptResume', () => {
  const r = (seq: number) => ({ seq, awayMs: AWAY_TOAST_MS + 1, editors: 1 })
  const oldSession = {}
  const newSession = {}

  it('fires each new resume of the same session once, and waits while the editor is not ready', () => {
    let g = { owner: oldSession, seq: 0 }
    expect(acceptResume(g, oldSession, r(1), false).fire).toBe(false)
    const a = acceptResume(g, oldSession, r(1), true)
    expect(a.fire).toBe(true)
    g = a.gate
    expect(acceptResume(g, oldSession, r(1), true).fire).toBe(false)
  })

  it('skips the resume already present at mount (remount dedupe)', () => {
    const g = { owner: oldSession, seq: 2 }
    expect(acceptResume(g, oldSession, r(2), true).fire).toBe(false)
  })

  it('dedupes per session — after renewing to a new session, its first resume (seq 1) still fires', () => {
    // 옛 세션에서 3번까지 처리한 화면이 같은 페이지의 새 세션으로 바뀜(useCollabSession renewal) — 새 세션은 resume 이 아직 없다.
    let g = acceptResume({ owner: oldSession, seq: 3 }, oldSession, r(3), true).gate
    const swap = acceptResume(g, newSession, null, true)
    expect(swap.fire).toBe(false)
    g = swap.gate
    const next = acceptResume(g, newSession, r(1), true)
    expect(next.fire).toBe(true)
  })

  it('on renewal skips the resume the new session already had at that moment', () => {
    const g = acceptResume({ owner: oldSession, seq: 0 }, newSession, r(4), true)
    expect(g.fire).toBe(false)
    expect(acceptResume(g.gate, newSession, r(5), true).fire).toBe(true)
  })
})
