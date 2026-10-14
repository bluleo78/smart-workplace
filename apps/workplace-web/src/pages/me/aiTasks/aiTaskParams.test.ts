import { describe, expect, it } from 'vitest'

import { aiTaskParams } from './aiTaskParams'

// URL → /me/ai-tasks 목록·건수 요청 파라미터. 건수는 빠른 필터(agentState)를 빼야 칩마다 전체 건수를 보여 줄 수 있다.
describe('aiTaskParams', () => {
  it('scope=all·state·facet 을 목록 파라미터로, 건수에서는 agentState 를 뺀다', () => {
    const out = aiTaskParams(new URLSearchParams('scope=all&state=INPUT_REQUIRED&status=TODO'))
    expect(out.list).toEqual({ status: 'TODO', scope: 'ALL', agentState: 'INPUT_REQUIRED' })
    expect(out.counts).toEqual({ status: 'TODO', scope: 'ALL' })
    expect(out.scope).toBe('all')
    expect(out.state).toBe('INPUT_REQUIRED')
  })

  it('막힘 칩은 BLOCKED 와 AUTH_REQUIRED 를 함께 요청하고 건수 요청엔 싣지 않는다', () => {
    const out = aiTaskParams(new URLSearchParams('state=BLOCKED'))
    expect(out.state).toBe('BLOCKED')
    expect(out.list).toEqual({ scope: 'MINE', agentState: 'BLOCKED,AUTH_REQUIRED' })
    expect(out.counts).toEqual({ scope: 'MINE' })
  })

  it('아무것도 없으면 나와 관련(MINE)·전체 상태', () => {
    const out = aiTaskParams(new URLSearchParams(''))
    expect(out.list).toEqual({ scope: 'MINE' })
    expect(out.counts).toEqual({ scope: 'MINE' })
    expect(out.scope).toBe('mine')
    expect(out.state).toBeNull()
  })

  it('모르는 state·scope 값은 무시한다(빠른 필터에 없는 PAUSED·SUBMITTED, 옛 값 WAITING 포함)', () => {
    for (const q of ['state=bogus', 'state=PAUSED', 'state=SUBMITTED', 'state=WAITING', 'state=input_required&scope=everyone']) {
      const out = aiTaskParams(new URLSearchParams(q))
      expect(out.state).toBeNull()
      expect(out.scope).toBe('mine')
      expect(out.list).toEqual({ scope: 'MINE' })
    }
  })

  it('서버가 무시하는 facet(마감·막힘)은 보내지 않고 필터로도 보지 않는다 — status·priority 만', () => {
    const out = aiTaskParams(
      new URLSearchParams('dueFrom=2026-10-01&dueTo=2026-10-31&blocked=true&dueDate=today&priority=HIGH'),
    )
    expect(out.facets).toEqual({ priority: 'HIGH' })
    expect(out.list).toEqual({ priority: 'HIGH', scope: 'MINE' })
    expect(out.counts).toEqual({ priority: 'HIGH', scope: 'MINE' })
    expect(out.filtered).toBe(true)

    const ignored = aiTaskParams(new URLSearchParams('dueTo=2026-10-31&blocked=true&dueDate=today'))
    expect(ignored.facets).toEqual({})
    expect(ignored.list).toEqual({ scope: 'MINE' })
    expect(ignored.filtered).toBe(false)
  })

  it('빠른 필터(state)만 켜져도 filtered, 범위(scope)는 필터가 아니다', () => {
    expect(aiTaskParams(new URLSearchParams('state=REVIEW')).filtered).toBe(true)
    expect(aiTaskParams(new URLSearchParams('scope=all')).filtered).toBe(false)
  })
})
