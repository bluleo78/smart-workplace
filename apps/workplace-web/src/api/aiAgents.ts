// AI 위임 작업 「AI별」 보기(WP-1201) — /me/ai-agents. AI 마다 연결 여부·열린 작업 행·자리 수를 받는다.
// 대표 상태·정렬·상태별 건수는 화면이 lib/aiRoster.ts 로 계산한다(AI 수가 적어 한 번에 다 받는다).
import type { AgentWorkState } from '../types/issue'
import type { UserSummary } from '../types/user'
import { client } from './client'

/** AI 의 열린 작업 한 건 — 내가 볼 수 있는 프로젝트의 이슈만 실린다(못 보는 것은 hiddenWorks 건수로만). */
export interface AiAgentWork {
  projectKey: string
  number: number
  title: string
  state: AgentWorkState
  note: string | null
  /** 마지막 보고 시각 — note 만 바뀌어도 갱신된다. */
  updatedAt: string
  /** 상태가 실제로 바뀐 시각 — 「n분째」의 기준(note 만 바뀌면 그대로). */
  stateChangedAt: string
  /** 무소식 — 작업 중인데 2시간 넘게 보고가 없다(서버 판정). */
  stale: boolean
}

export interface AiAgentStatus {
  agent: UserSummary
  description: string | null
  /** 알림 구독(SSE) 연결이 있는가 — 서버 안에서 도는 AI(INTERNAL)는 null(판단하지 않음). */
  connected: boolean | null
  /** 연결이 마지막으로 끊긴 시각 — 연결 중이거나 한 번도 붙은 적 없으면 null. */
  disconnectedAt: string | null
  /** 마지막으로 작업을 끝낸 시각 — 「쉬는 중 n분째」의 기준. */
  lastEndedAt: string | null
  works: AiAgentWork[]
  /** 내가 볼 수 없는 프로젝트의 열린 작업 수. */
  hiddenWorks: number
  /** 동시 진행 상한에 세는 행 수(못 보는 프로젝트 포함) — work-loop 상한(WP-1040)과 같은 기준으로 서버가 센다. */
  slotsUsed: number
}

export interface AiAgentsResponse {
  agents: AiAgentStatus[]
  /** 동시 진행 상한 — work-loop 와 같은 값. */
  slotLimit: number
}

export async function fetchAiAgents(scope: 'MINE' | 'ALL'): Promise<AiAgentsResponse> {
  const { data } = await client.get<AiAgentsResponse>(`/me/ai-agents?scope=${scope}`)
  return data
}
