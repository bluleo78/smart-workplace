import { describe, expect, it } from 'vitest'

import type { AgentWorkView } from '../types/issue'
import { AGENT_STATE_LABEL, agentStateTone, agentToolLabel, displayState, primaryWork, progressView, questionWork } from './agentWork'

const w = (state: AgentWorkView['state'], extra: Partial<AgentWorkView> = {}): AgentWorkView => ({
  worker: { id: 1, username: 'me', name: '나', kind: 'HUMAN' }, tool: 'claude-code', state, note: null,
  progress: null, stepsDone: null, stepsTotal: null, startedAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', stale: false, ...extra,
})

describe('AGENT_STATE_LABEL', () => {
  it('A2A 상태 어휘의 화면 라벨', () => {
    expect(AGENT_STATE_LABEL.INPUT_REQUIRED).toBe('답변 필요')
    expect(AGENT_STATE_LABEL.AUTH_REQUIRED).toBe('인증 필요')
    expect(AGENT_STATE_LABEL.SUBMITTED).toBe('시작 전')
  })
  it('종료 상태 라벨(WP-396 완료 보기)', () => {
    expect(AGENT_STATE_LABEL.COMPLETED).toBe('완료')
    expect(AGENT_STATE_LABEL.FAILED).toBe('실패')
    expect(AGENT_STATE_LABEL.CANCELED).toBe('취소')
    expect(AGENT_STATE_LABEL.REJECTED).toBe('반려')
  })
})
describe('agentStateTone', () => {
  it('사람이 할 일은 action, 작업 중은 info, 막힘은 warning', () => {
    for (const s of ['INPUT_REQUIRED', 'AUTH_REQUIRED', 'REVIEW'] as const) expect(agentStateTone(s)).toBe('action')
    expect(agentStateTone('WORKING')).toBe('info')
    expect(agentStateTone('BLOCKED')).toBe('warning')
  })
  it('종료 결과 — 완료는 success, 실패는 destructive, 취소·반려는 중립(muted)', () => {
    expect(agentStateTone('COMPLETED')).toBe('success')
    expect(agentStateTone('FAILED')).toBe('destructive')
    expect(agentStateTone('CANCELED')).toBe('muted')
    expect(agentStateTone('REJECTED')).toBe('muted')
  })
  it('일시 중지·시작 전은 중립', () => {
    for (const s of ['PAUSED', 'SUBMITTED', 'NOT_STARTED'] as const) expect(agentStateTone(s)).toBe('muted')
  })
})
describe('primaryWork', () => {
  it('서버가 급한 순으로 준 첫 건', () => expect(primaryWork([w('INPUT_REQUIRED'), w('WORKING')])?.state).toBe('INPUT_REQUIRED'))
  it('없으면 null', () => expect(primaryWork(undefined)).toBeNull())
})
describe('progressView', () => {
  it('단계가 있으면 글자는 단계, 막대는 progress 우선', () => expect(progressView(w('WORKING', { progress: 80, stepsDone: 3, stepsTotal: 5 }))).toEqual({ pct: 80, text: '3/5' }))
  it('단계만', () => expect(progressView(w('WORKING', { stepsDone: 1, stepsTotal: 4 }))).toEqual({ pct: 25, text: '1/4' }))
  it('퍼센트만', () => expect(progressView(w('WORKING', { progress: 40 }))).toEqual({ pct: 40, text: '40%' }))
  it('없으면 null', () => expect(progressView(w('WORKING'))).toBeNull())
})
describe('agentToolLabel', () => {
  it('알려진 이름', () => expect(agentToolLabel('claude-code')).toBe('Claude Code'))
  it('모르면 원문', () => expect(agentToolLabel('mcp')).toBe('mcp'))
})
describe('displayState', () => {
  const agent = { id: 9, username: 'aki', name: '아키', kind: 'AGENT' as const }
  it('작업 없고 AI 담당 TODO 면 시작 전', () => expect(displayState({ assignees: [agent], status: 'TODO' })).toBe('NOT_STARTED'))
  it('작업 없고 진행 중이면 null', () => expect(displayState({ assignees: [agent], status: 'IN_PROGRESS' })).toBeNull())
  it('시작 전(SUBMITTED) 행이 대표면 그 상태 — 도구는 아직 null', () =>
    expect(displayState({ assignees: [agent], status: 'TODO', agentWork: [w('SUBMITTED', { tool: null })] })).toBe('SUBMITTED'))
  it('종료 작업이 대표면(완료 보기) 그 종료 상태', () =>
    expect(displayState({ assignees: [agent], status: 'DONE', agentWork: [w('COMPLETED')] })).toBe('COMPLETED'))
  it('작업 있으면 대표 상태', () => expect(displayState({ assignees: [agent], status: 'TODO', agentWork: [w('BLOCKED')] })).toBe('BLOCKED'))
})
describe('questionWork', () => {
  const agent = { id: 9, username: 'aki', name: '아키', kind: 'AGENT' as const }
  it('AI 구성원의 답변 필요 첫 건', () =>
    expect(questionWork([w('INPUT_REQUIRED'), w('WORKING', { worker: agent }), w('INPUT_REQUIRED', { worker: agent, note: 'q' })])?.note).toBe('q'))
  it('AI 구성원의 인증 필요는 질문 카드에 올리지 않는다', () => expect(questionWork([w('AUTH_REQUIRED', { worker: agent })])).toBeNull())
  it('사람의 답변 필요만 있으면 null', () => expect(questionWork([w('INPUT_REQUIRED')])).toBeNull())
  it('없으면 null', () => expect(questionWork(undefined)).toBeNull())
})
