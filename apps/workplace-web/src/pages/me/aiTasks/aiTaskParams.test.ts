import { describe, expect, it } from 'vitest'

import { aiTaskParams, QUICK_STATE_META, QUICK_STATES } from './aiTaskParams'

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

  it('대기 중 칩(state=WAITING)은 agentState=WAITING 으로 목록을 거른다(WP-1024)', () => {
    const out = aiTaskParams(new URLSearchParams('state=WAITING'))
    expect(out.state).toBe('WAITING')
    expect(out.list).toEqual({ scope: 'MINE', agentState: 'WAITING' })
    expect(out.counts).toEqual({ scope: 'MINE' })
  })

  it('완료 칩(state=DONE)은 종료 상태 넷을 함께 요청하고 건수 요청엔 싣지 않는다(WP-396)', () => {
    const out = aiTaskParams(new URLSearchParams('state=DONE&scope=all'))
    expect(out.state).toBe('DONE')
    expect(out.list).toEqual({ scope: 'ALL', agentState: 'COMPLETED,FAILED,CANCELED,REJECTED' })
    expect(out.counts).toEqual({ scope: 'ALL' })
    expect(out.filtered).toBe(true)
    expect(out.doneView).toBe(true)
  })

  it('완료 칩에 facet 이 함께 걸리면 완료 보기가 아니라 조건 필터다(WP-917)', () => {
    const out = aiTaskParams(new URLSearchParams('state=DONE&priority=HIGH'))
    expect(out.filtered).toBe(true)
    expect(out.doneView).toBe(false)
    expect(aiTaskParams(new URLSearchParams('state=REVIEW')).doneView).toBe(false)
    expect(aiTaskParams(new URLSearchParams('')).doneView).toBe(false)
  })

  it('칩 순서는 미완료 다음 답변·검토·막힘·작업 중·대기 중·다음 회차 대기, 마지막이 완료 — 칩 라벨·건수 키', () => {
    expect(QUICK_STATES).toEqual(['INPUT_REQUIRED', 'REVIEW', 'BLOCKED', 'WORKING', 'WAITING', 'SCHEDULED', 'DONE'])
    // WP-1024: 대기 중은 다른 사람·AI 의 차례 — 「답변 필요」와 섞이지 않는 라벨.
    expect(QUICK_STATE_META.WAITING).toMatchObject({ countKey: 'waiting', label: '대기 중', agentState: 'WAITING' })
    expect(QUICK_STATE_META.SCHEDULED).toMatchObject({ countKey: 'scheduled', label: '다음 회차 대기', agentState: 'SCHEDULED' })
    expect(QUICK_STATE_META.DONE).toMatchObject({ countKey: 'done', label: '완료' })
    expect(QUICK_STATE_META.INPUT_REQUIRED.label).toBe('답변 필요')
  })

  it('아무것도 없으면 나와 관련(MINE)·미완료(state 없음)', () => {
    const out = aiTaskParams(new URLSearchParams(''))
    expect(out.list).toEqual({ scope: 'MINE' })
    expect(out.counts).toEqual({ scope: 'MINE' })
    expect(out.scope).toBe('mine')
    expect(out.state).toBeNull()
  })

  it('모르는 state·scope 값은 무시한다(빠른 필터에 없는 PAUSED·SUBMITTED)', () => {
    for (const q of ['state=bogus', 'state=PAUSED', 'state=SUBMITTED', 'state=input_required&scope=everyone']) {
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
