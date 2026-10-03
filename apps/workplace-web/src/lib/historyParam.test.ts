// useHistoryParam 판정 테스트 — 가짜 히스토리 스택(react-router createBrowserHistory 의 idx 규칙만 흉내)으로
// 열기 push·전환 replace·닫기 3규칙·하위 push·forward·state 모드·닫기 가드를 고정한다(WP-205).
import { describe, expect, it } from 'vitest'

import {
  createCloseGuard,
  type HistoryPlan,
  type HistorySnapshot,
  markKey,
  planClose,
  planOpen,
  readHistoryParam,
  type RouterState,
} from './historyParam'

/**
 * 가짜 히스토리 — push 는 앞쪽 기록을 잘라내고 idx+1, replace 는 idx 유지, go 는 이동.
 * initial 의 마지막 항목이 현재 위치다(그 앞 항목 수 = 현재 idx).
 */
function fakeHistory(initial: { search: string; state?: RouterState }[]) {
  const entries = initial.map((e) => ({ search: e.search, state: e.state ?? null }))
  let idx = entries.length - 1
  return {
    snap: (): HistorySnapshot => ({ search: entries[idx].search, state: entries[idx].state, idx }),
    apply(plan: HistoryPlan) {
      if (plan.kind === 'none') return
      if (plan.kind === 'go') {
        idx += plan.delta
        return
      }
      if (plan.kind === 'replace') {
        entries[idx] = { search: plan.search, state: plan.state }
        return
      }
      entries.splice(idx + 1)
      entries.push({ search: plan.search, state: plan.state })
      idx += 1
    },
    /** 오버레이 안 하위 push(드로워 폴더 이동) — 이전 router state 를 spread 해 마크를 잇는다. */
    subPush(search: string) {
      const prev = entries[idx].state
      entries.splice(idx + 1)
      entries.push({ search, state: prev ? { ...prev } : null })
      idx += 1
    },
    forward() {
      idx += 1
    },
    idx: () => idx,
    length: () => entries.length,
  }
}

describe('planOpen', () => {
  it('닫힌 상태에서 열면 ?key 를 push 하고 마크에 push 될 항목 idx(현재+1)를 남긴다', () => {
    const h = fakeHistory([{ search: '' }, { search: '?folder=sent' }])
    h.apply(planOpen(h.snap(), 'messageId', '10'))
    expect(h.idx()).toBe(2)
    expect(h.snap().search).toBe('?folder=sent&messageId=10')
    expect((h.snap().state as Record<string, unknown>)[markKey('messageId')]).toBe(2)
  })

  it('이미 열린 상태에서 다른 값은 replace — idx·마크 보존', () => {
    const h = fakeHistory([{ search: '' }])
    h.apply(planOpen(h.snap(), 'messageId', '10'))
    h.apply(planOpen(h.snap(), 'messageId', '11'))
    expect(h.idx()).toBe(1)
    expect(h.length()).toBe(2)
    expect(readHistoryParam(h.snap(), 'messageId')).toBe('11')
    expect((h.snap().state as Record<string, unknown>)[markKey('messageId')]).toBe(1)
  })

  it('같은 값 재열기는 무동작', () => {
    const h = fakeHistory([{ search: '?messageId=10' }])
    expect(planOpen(h.snap(), 'messageId', '10')).toEqual({ kind: 'none' })
  })

  it('clear 키는 열 때 함께 지운다(다른 쿼리는 보존)', () => {
    const h = fakeHistory([{ search: '?q=x&filesFolder=3' }])
    h.apply(planOpen(h.snap(), 'files', '1', { clear: ['filesFolder', 'preview'] }))
    expect(h.snap().search).toBe('?q=x&files=1')
  })
})

describe('planClose', () => {
  it('마크가 있으면 연 시점 직전까지 되돌린다', () => {
    const h = fakeHistory([{ search: '' }, { search: '' }])
    h.apply(planOpen(h.snap(), 'messageId', '10'))
    expect(planClose(h.snap(), 'messageId')).toEqual({ kind: 'go', delta: -1 })
    h.apply(planClose(h.snap(), 'messageId'))
    expect(h.idx()).toBe(1)
    expect(h.snap().search).toBe('')
  })

  it('하위 push 3회 뒤 닫기 = 한 번에 연 시점 직전', () => {
    const h = fakeHistory([{ search: '' }])
    h.apply(planOpen(h.snap(), 'files', '1'))
    h.subPush('?files=1&filesFolder=1')
    h.subPush('?files=1&filesFolder=2')
    h.subPush('?files=1&filesFolder=3')
    expect(planClose(h.snap(), 'files')).toEqual({ kind: 'go', delta: -4 })
    h.apply(planClose(h.snap(), 'files'))
    expect(h.idx()).toBe(0)
  })

  it('마크 없고 idx>0(다른 화면 링크로 진입) → -1(출발 화면)', () => {
    const h = fakeHistory([{ search: '' }, { search: '?messageId=10' }])
    expect(planClose(h.snap(), 'messageId')).toEqual({ kind: 'go', delta: -1 })
  })

  it('콜드 진입(idx 0) → 키와 clear 하위 키만 지우고 replace, 다른 쿼리 보존', () => {
    const h = fakeHistory([{ search: '?q=a&files=1&filesFolder=7', state: { keep: 1 } }])
    expect(planClose(h.snap(), 'files', { clear: ['filesFolder', 'preview'] })).toEqual({
      kind: 'replace',
      search: '?q=a',
      state: { keep: 1 },
    })
  })

  it('값이 없으면 무동작', () => {
    const h = fakeHistory([{ search: '?q=a' }])
    expect(planClose(h.snap(), 'messageId')).toEqual({ kind: 'none' })
  })

  it('닫은 뒤 forward 로 다시 열리면 같은 마크로 다시 닫힌다', () => {
    const h = fakeHistory([{ search: '' }])
    h.apply(planOpen(h.snap(), 'thread', '5'))
    h.apply(planClose(h.snap(), 'thread'))
    h.forward()
    expect(readHistoryParam(h.snap(), 'thread')).toBe('5')
    expect(planClose(h.snap(), 'thread')).toEqual({ kind: 'go', delta: -1 })
  })

  it('마크가 현재보다 앞(비정상)이면 마크를 무시하고 규칙 2·3 으로', () => {
    const h = fakeHistory([{ search: '?task=1', state: { [markKey('task')]: 5 } }])
    expect(planClose(h.snap(), 'task').kind).toBe('replace')
  })
})

describe('state 모드', () => {
  it('열기는 같은 search 에 state[key] 와 마크를 push, 닫기는 되돌림', () => {
    const h = fakeHistory([{ search: '?messageId=10', state: { [markKey('messageId')]: 0 } }])
    h.apply(planOpen(h.snap(), 'aiOpen', '1', { mode: 'state' }))
    expect(h.snap().search).toBe('?messageId=10')
    expect(readHistoryParam(h.snap(), 'aiOpen', 'state')).toBe('1')
    // 이전 마크(메일 상세)는 spread 로 이어진다.
    expect((h.snap().state as Record<string, unknown>)[markKey('messageId')]).toBe(0)
    expect(planClose(h.snap(), 'aiOpen', { mode: 'state' })).toEqual({ kind: 'go', delta: -1 })
  })

  it('콜드(새로고침으로 state 만 남음) 닫기는 state 에서 키·마크를 지우고 replace', () => {
    const h = fakeHistory([{ search: '', state: { aiOpen: '1', [markKey('aiOpen')]: 3 } }])
    expect(planClose(h.snap(), 'aiOpen', { mode: 'state' })).toEqual({ kind: 'replace', search: '', state: null })
  })
})

describe('createCloseGuard', () => {
  it('같은 location.key 의 두 번째 닫기는 거절, reset 후 다시 허용', () => {
    const g = createCloseGuard()
    expect(g.claim('k1')).toBe(true)
    expect(g.claim('k1')).toBe(false)
    g.reset()
    expect(g.claim('k1')).toBe(true)
  })
})
