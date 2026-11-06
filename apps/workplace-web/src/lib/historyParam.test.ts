// useHistoryParam 판정 테스트 — 가짜 히스토리 스택(react-router createBrowserHistory 의 idx 규칙만 흉내)으로
// 열기 push·전환 replace·닫기 3규칙·하위 push·forward·state 모드·닫기 가드를 고정한다(WP-205).
import { describe, expect, it } from 'vitest'

import {
  createCloseGuard,
  hasOpenMark,
  type HistoryPlan,
  type HistorySnapshot,
  markKey,
  parseId,
  planClose,
  planOpen,
  planUnmarkedEntry,
  readHistoryParam,
  type RouterState,
  stripHistoryKey,
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

  // WP-1374: 겹친 화면(모달 위 서랍)은 마크 없이 열렸을 때 뒤로(-1) 가면 아래 모달까지 닫힌다 — replace 로 키만 지운다.
  describe("unmarkedClose='replace'", () => {
    const opts = { unmarkedClose: 'replace' as const }

    it('마크가 있으면 기본과 같이 연 시점 직전으로 되돌린다', () => {
      const h = fakeHistory([{ search: '?task=1', state: { [markKey('task')]: 1 } }])
      h.apply(planOpen(h.snap(), 'chat', '1'))
      expect(planClose(h.snap(), 'chat', opts)).toEqual({ kind: 'go', delta: -1 })
    })

    it('마크 없고 idx>0(링크로 진입)이어도 -1 이 아니라 chat 만 지우고 replace — 다른 쿼리·마크 보존', () => {
      const h = fakeHistory([{ search: '' }, { search: '?task=1&chat=1', state: { [markKey('task')]: 1, keep: 1 } }])
      expect(planClose(h.snap(), 'chat', opts)).toEqual({
        kind: 'replace',
        search: '?task=1',
        state: { [markKey('task')]: 1, keep: 1 },
      })
    })

    it('낡은 마크(현재 idx 보다 뒤 — 다른 항목에서 이어받음)는 무시하고 replace, 그 마크도 지운다', () => {
      const h = fakeHistory([{ search: '' }, { search: '?task=1&chat=1', state: { [markKey('chat')]: 7 } }])
      expect(planClose(h.snap(), 'chat', opts)).toEqual({ kind: 'replace', search: '?task=1', state: null })
    })

    it('마크 값이 숫자가 아니거나 0 이면(어긋난 마크) replace', () => {
      for (const bad of ['1', 0]) {
        const h = fakeHistory([{ search: '' }, { search: '?task=1&chat=1', state: { [markKey('chat')]: bad } }])
        expect(planClose(h.snap(), 'chat', opts)).toEqual({ kind: 'replace', search: '?task=1', state: null })
      }
    })
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

describe('stripHistoryKey', () => {
  it('query 모드는 마크만 지우고 다른 state(와 같은 이름 키)는 보존', () => {
    expect(stripHistoryKey({ [markKey('chat')]: 2, chat: 'x', other: 1 }, 'chat')).toEqual({ chat: 'x', other: 1 })
  })

  it('state 모드는 키와 마크를 함께 지운다', () => {
    expect(stripHistoryKey({ [markKey('aiOpen')]: 3, aiOpen: '1', other: 1 }, 'aiOpen', 'state')).toEqual({ other: 1 })
  })

  it('남는 게 없거나 state 가 객체가 아니면 null', () => {
    expect(stripHistoryKey({ [markKey('aiOpen')]: 3, aiOpen: '1' }, 'aiOpen', 'state')).toBeNull()
    expect(stripHistoryKey(null, 'aiOpen', 'state')).toBeNull()
    expect(stripHistoryKey('x', 'chat')).toBeNull()
  })
})

describe('parseId', () => {
  it('양의 정수 문자열은 숫자', () => {
    expect(parseId('1')).toBe(1)
    expect(parseId('42')).toBe(42)
  })

  it('비었거나 0·음수·소수·숫자 아님은 null', () => {
    for (const v of [null, '', '0', '-3', '1.5', 'abc', 'NaN', 'Infinity']) expect(parseId(v)).toBeNull()
  })
})

describe('hasOpenMark', () => {
  it('열기 push 의 state 에만 마크가 있고, 전환 replace 는 이어받는다', () => {
    const push = planOpen({ search: '', state: null, idx: 2 }, 'messageId', '7')
    expect(push.kind).toBe('push')
    const pushed = push.kind === 'push' ? push.state : null
    expect(hasOpenMark(pushed, 'messageId')).toBe(true)
    const replace = planOpen({ search: '?messageId=7', state: pushed, idx: 3 }, 'messageId', '8')
    expect(replace.kind === 'replace' && hasOpenMark(replace.state, 'messageId')).toBe(true)
  })
  it('콜드 딥링크(state 없음)·다른 키 마크는 false', () => {
    expect(hasOpenMark(null, 'messageId')).toBe(false)
    expect(hasOpenMark({ [markKey('contact')]: 1 }, 'messageId')).toBe(false)
  })
})

describe('planUnmarkedEntry', () => {
  it('마크 없는 ?chat=1 은 chat 을 뺀 replace(다른 쿼리·state 보존) + 마크를 단 push 로 편다(WP-1414)', () => {
    const h = fakeHistory([{ search: '?tab=inbox' }, { search: '?view=list&chat=1', state: { from: 'inbox' } }])
    const plan = planUnmarkedEntry(h.snap(), 'chat')
    expect(plan).toEqual([
      { kind: 'replace', search: '?view=list', state: { from: 'inbox' } },
      { kind: 'push', search: '?view=list&chat=1', state: { from: 'inbox', [markKey('chat')]: 2 } },
    ])
    for (const step of plan!) h.apply(step)
    // 출발 화면 → 이슈 → 이슈+채팅(마크): 닫기는 이슈로(-1), 한 번 더 뒤로 가면 출발 화면.
    expect(h.length()).toBe(3)
    expect(planClose(h.snap(), 'chat')).toEqual({ kind: 'go', delta: -1 })
    h.apply(planClose(h.snap(), 'chat'))
    expect(h.snap().search).toBe('?view=list')
    // 펴고 난 항목은 마크가 있어 다시 계획하지 않는다(StrictMode·다시 그리기에도 한 번만).
    h.forward()
    expect(planUnmarkedEntry(h.snap(), 'chat')).toBeNull()
  })

  it('새 탭(idx 0)도 같은 모양 — 마크는 1', () => {
    const plan = planUnmarkedEntry({ search: '?chat=1', state: null, idx: 0 }, 'chat')
    expect(plan).toEqual([
      { kind: 'replace', search: '', state: null },
      { kind: 'push', search: '?chat=1', state: { [markKey('chat')]: 1 } },
    ])
  })

  it('이미 마크가 있으면(앱 안에서 연 항목·새로고침) null', () => {
    expect(planUnmarkedEntry({ search: '?chat=1', state: { [markKey('chat')]: 3 }, idx: 3 }, 'chat')).toBeNull()
  })

  it('chat 이 없으면 null', () => {
    expect(planUnmarkedEntry({ search: '?view=list', state: null, idx: 2 }, 'chat')).toBeNull()
  })

  it('지금 값을 그대로 다시 연다 — push 는 같은 값·마크', () => {
    expect(planUnmarkedEntry({ search: '?chat=0', state: null, idx: 2 }, 'chat')).toEqual([
      { kind: 'replace', search: '', state: null },
      { kind: 'push', search: '?chat=0', state: { [markKey('chat')]: 3 } },
    ])
  })
})
