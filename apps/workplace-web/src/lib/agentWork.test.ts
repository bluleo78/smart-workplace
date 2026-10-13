import { describe, expect, it } from 'vitest'

import type { AgentWorkView } from '../types/issue'
import { agentToolLabel, displayState, primaryWork, progressView, questionWork } from './agentWork'

const w = (state: AgentWorkView['state'], extra: Partial<AgentWorkView> = {}): AgentWorkView => ({
  worker: { id: 1, username: 'me', name: '나', kind: 'HUMAN' }, tool: 'claude-code', state, note: null,
  progress: null, stepsDone: null, stepsTotal: null, startedAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', stale: false, ...extra,
})

describe('primaryWork', () => {
  it('가장 급한 상태', () => expect(primaryWork([w('WORKING'), w('REVIEW'), w('WAITING')])?.state).toBe('WAITING'))
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
  it('작업 있으면 대표 상태', () => expect(displayState({ assignees: [agent], status: 'TODO', agentWork: [w('BLOCKED')] })).toBe('BLOCKED'))
})
describe('questionWork', () => {
  const agent = { id: 9, username: 'aki', name: '아키', kind: 'AGENT' as const }
  it('AI 구성원의 답변 필요 첫 건', () =>
    expect(questionWork([w('WAITING'), w('WORKING', { worker: agent }), w('WAITING', { worker: agent, note: 'q' })])?.note).toBe('q'))
  it('사람의 답변 필요만 있으면 null', () => expect(questionWork([w('WAITING')])).toBeNull())
  it('없으면 null', () => expect(questionWork(undefined)).toBeNull())
})
