// AI 작업 진행(WP-377) 모킹 데이터 팩토리 — 이슈 응답의 agentWork 한 건과 /me/ai-tasks/counts 응답.
import type { AiTaskCounts } from '../../src/api/aiTasks'
import type { AgentWorkView } from '../../src/types/issue'
import type { UserSummary } from '../../src/types/user'

/** 기본 작업자 — AI 구성원(아바타에 에이전트 표식이 붙는다). */
export const agentWorker: UserSummary = { id: 9, username: 'aki', name: '아키', kind: 'AGENT' }

/** 지금으로부터 min 분 전 ISO 시각 — 마지막 보고 상대 시각(relTime) 검증용. 버킷 경계를 피하는 값을 넘긴다. */
export const minutesAgo = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

/** AI 작업 한 건 — 기본은 Claude Code 로 30분 전 보고한 작업 중 상태. */
export function createAgentWork(overrides: Partial<AgentWorkView> = {}): AgentWorkView {
  return {
    worker: agentWorker,
    tool: 'claude-code',
    state: 'WORKING',
    note: null,
    progress: null,
    stepsDone: null,
    stepsTotal: null,
    startedAt: minutesAgo(240),
    updatedAt: minutesAgo(30),
    stale: false,
    ...overrides,
  }
}

/** 상태별 건수 응답 — 기본 모두 0. */
export function createAiTaskCounts(overrides: Partial<AiTaskCounts> = {}): AiTaskCounts {
  return { all: 0, waiting: 0, review: 0, blocked: 0, working: 0, ...overrides }
}
