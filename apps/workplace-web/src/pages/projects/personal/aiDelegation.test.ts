import { describe, expect, it } from 'vitest'

import type { AgentWorkView } from '../../../types/issue'
import { delegationState } from './aiDelegation'

const agent = { id: 9, username: 'aki', name: '아키', kind: 'AGENT' as const }
const human = { id: 1, username: 'me', name: '나', kind: 'HUMAN' as const }
const work = (state: AgentWorkView['state']): AgentWorkView => ({
  worker: agent, tool: 'claude-code', state, note: null, progress: null, stepsDone: null, stepsTotal: null,
  startedAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', stale: false,
})

// 체크리스트 행 배지 — 진행 중 작업이 있으면 대표 상태, 없고 AI 담당이면 AI 위임(TODO 는 시작 전), 그 외 없음.
describe('delegationState', () => {
  it('진행 중 작업이 있으면 서버가 급한 순으로 준 첫 건의 상태', () =>
    expect(delegationState({ assignees: [agent], status: 'IN_PROGRESS', agentWork: [work('BLOCKED'), work('WORKING')] })).toBe('BLOCKED'))
  it('사람만 담당이어도 작업이 있으면 대표 상태', () =>
    expect(delegationState({ assignees: [human], status: 'IN_PROGRESS', agentWork: [work('WAITING')] })).toBe('WAITING'))
  it('작업 없고 AI 담당 TODO 면 시작 전', () =>
    expect(delegationState({ assignees: [agent], status: 'TODO' })).toBe('NOT_STARTED'))
  it('작업 없고 AI 담당 진행 중이면 AI 위임', () =>
    expect(delegationState({ assignees: [agent], status: 'IN_PROGRESS' })).toBe('DELEGATED'))
  it('작업 없고 AI 담당 아니면 없음', () =>
    expect(delegationState({ assignees: [human], status: 'TODO' })).toBeNull())
})
