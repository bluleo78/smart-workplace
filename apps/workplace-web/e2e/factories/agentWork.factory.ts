// AI 작업 진행(WP-377) 모킹 데이터 팩토리 — 이슈 응답의 agentWork 한 건과 /me/ai-tasks/counts 응답.
import type { AiTaskCounts } from '../../src/api/aiTasks'
import type { AgentWorkView } from '../../src/types/issue'
import type { UserSummary } from '../../src/types/user'

/** 기본 작업자 — AI 구성원(아바타에 에이전트 표식이 붙는다). */
export const agentWorker: UserSummary = { id: 9, username: 'aki', name: '아키', kind: 'AGENT' }

/** 사람 작업자 — 이슈 상세 AI 진행 spec 공용(담당자·작업자 모두 이 사용자). */
export const humanWorker: UserSummary = { id: 1, username: 'dh.yang@iacloud.kr', name: '양동희', kind: 'HUMAN' }

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

/** 상태별 건수 응답 — 기본 모두 0(all 은 미완료, blocked 는 막힘 + 인증 필요 합, done 은 완료). */
export function createAiTaskCounts(overrides: Partial<AiTaskCounts> = {}): AiTaskCounts {
  return { all: 0, inputRequired: 0, review: 0, blocked: 0, working: 0, done: 0, ...overrides }
}

/**
 * 서버 순서(급한 순) 그대로의 두 작업 — AI 구성원이 질문을 남기고 답변 대기(62분 전) + 사람이 Claude Code 로 작업 중(3/5, 5분 전).
 * 상대 시각이 테스트 시작 시점 기준이 되도록 호출 시점에 만든다(모듈 로드 시각이면 늦게 도는 테스트에서 분이 밀린다).
 */
export const twoWorks = (akiNote: string): AgentWorkView[] => [
  createAgentWork({ worker: agentWorker, state: 'INPUT_REQUIRED', note: akiNote, updatedAt: minutesAgo(62) }),
  createAgentWork({ worker: humanWorker, state: 'WORKING', note: 'MCP 헤더 처리 중', stepsDone: 3, stepsTotal: 5, updatedAt: minutesAgo(5) }),
]
