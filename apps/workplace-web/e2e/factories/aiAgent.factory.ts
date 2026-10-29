// AI 위임 작업 「AI별」 보기(WP-1201) 모킹 데이터 팩토리 — /me/ai-agents 응답의 AI 한 명과 열린 작업 한 건.
import type { AiAgentStatus, AiAgentWork, AiAgentsResponse } from '../../src/api/aiAgents'
import { minutesAgo } from './agentWork.factory'

/** 열린 작업 한 건 — 기본은 WP-1 「작업」 작업 중, 상태·보고 모두 5분 전. */
export function createAiAgentWork(o: Partial<AiAgentWork> = {}): AiAgentWork {
  return {
    projectKey: 'WP',
    number: 1,
    title: '작업',
    state: 'WORKING',
    note: null,
    updatedAt: minutesAgo(5),
    stateChangedAt: minutesAgo(5),
    stale: false,
    ...o,
  }
}

/** AI 한 명 — 기본은 외부 실행·연결됨·작업 없음. 자리 수(slotsUsed)는 주지 않으면 작업 수(서버 판정은 테스트가 필요할 때 직접 준다). */
export function createAiAgentStatus(id: number, name: string, o: Partial<AiAgentStatus> = {}): AiAgentStatus {
  const works = o.works ?? []
  return {
    agent: { id, username: `ai${id}@example.com`, name, kind: 'AGENT' },
    description: null,
    connected: true,
    disconnectedAt: null,
    lastEndedAt: null,
    hiddenWorks: 0,
    slotsUsed: works.length,
    ...o,
    works,
  }
}

export function createAiAgentsResponse(agents: AiAgentStatus[], slotLimit = 3): AiAgentsResponse {
  return { agents, slotLimit }
}
