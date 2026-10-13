import { describe, expect, it } from 'vitest'

import { aiTaskParams } from './aiTaskParams'

// URL → /me/ai-tasks 목록·건수 요청 파라미터. 건수는 빠른 필터(agentState)를 빼야 칩마다 전체 건수를 보여 줄 수 있다.
describe('aiTaskParams', () => {
  it('scope=all·state·facet 을 목록 파라미터로, 건수에서는 agentState 를 뺀다', () => {
    const out = aiTaskParams(new URLSearchParams('scope=all&state=WAITING&status=TODO'))
    expect(out.list).toEqual({ status: 'TODO', scope: 'ALL', agentState: 'WAITING' })
    expect(out.counts).toEqual({ status: 'TODO', scope: 'ALL' })
    expect(out.scope).toBe('all')
    expect(out.state).toBe('WAITING')
  })

  it('아무것도 없으면 나와 관련(MINE)·전체 상태', () => {
    const out = aiTaskParams(new URLSearchParams(''))
    expect(out.list).toEqual({ scope: 'MINE' })
    expect(out.counts).toEqual({ scope: 'MINE' })
    expect(out.scope).toBe('mine')
    expect(out.state).toBeNull()
  })

  it('모르는 state·scope 값은 무시한다(빠른 필터에 없는 PAUSED 포함)', () => {
    for (const q of ['state=bogus', 'state=PAUSED', 'state=waiting&scope=everyone']) {
      const out = aiTaskParams(new URLSearchParams(q))
      expect(out.state).toBeNull()
      expect(out.scope).toBe('mine')
      expect(out.list).toEqual({ scope: 'MINE' })
    }
  })
})
