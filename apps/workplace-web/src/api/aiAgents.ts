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
  /** 마지막으로 연결을 확인한 시각(약 1분 단위) — 연결 중이거나 모르면(붙은 적 없음·하루 넘게 지남) null. */
  disconnectedAt: string | null
  /** 마지막으로 작업을 끝낸 시각 — 「쉬는 중 n분째」의 기준. */
  lastEndedAt: string | null
  works: AiAgentWork[]
  /** 내가 볼 수 없는 프로젝트의 열린 작업 수. */
  hiddenWorks: number
  /** 동시 진행 상한에 세는 행 수(못 보는 프로젝트 포함) — work-loop 상한(WP-1040)과 같은 기준으로 서버가 센다. */
  slotsUsed: number
  /** 이 AI 의 동시 진행 상한(WP-1754) — AI 마다 다르며 서버가 항상 보낸다. */
  slotLimit: number
}

export interface AiAgentsResponse {
  agents: AiAgentStatus[]
  /** 동시 진행 상한 기본값(호환용) — AI 마다 값은 agents[].slotLimit. */
  slotLimit: number
}

/** 서버 기본 동시 진행 상한(AgentSlotLimits.DEFAULT = 5 와 같다) — 응답에 상한이 아예 없을 때만 쓴다. */
const DEFAULT_SLOT_LIMIT = 5

export async function fetchAiAgents(scope: 'MINE' | 'ALL'): Promise<AiAgentsResponse> {
  const { data } = await client.get<AiAgentsResponse>(`/me/ai-agents?scope=${scope}`)
  // 배포가 섞인 동안 옛 API(WP-1754 전) 응답에는 agents[].slotLimit 이 없다(WP-1775) — 여기서 한 번 채워 화면은 늘 값이 있다고 본다.
  // 모든 운영 서버가 WP-1754 이후(AI별 slotLimit)로 배포되면 이 대체값과 DEFAULT_SLOT_LIMIT 을 지운다.
  const fallback = data.slotLimit ?? DEFAULT_SLOT_LIMIT
  return { ...data, agents: data.agents.map((a) => ({ ...a, slotLimit: a.slotLimit ?? fallback })) }
}
