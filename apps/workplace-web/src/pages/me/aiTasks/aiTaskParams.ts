// AI 위임 작업 화면의 URL → /me/ai-tasks 요청 파라미터 변환(WP-377).
// URL 이 단일 원본 — 범위(scope)·빠른 필터(state)·facet(status/priority)을 모두 쿼리스트링으로 들고 다녀
// 새로고침·링크 공유에도 같은 화면이 나온다.
import { AGENT_STATE_LABEL, TERMINAL_AGENT_STATES } from '@/lib/agentWork'

import { meFacetParams } from '../meFacetParams'

/**
 * 빠른 필터 칩이 다루는 값(URL `state`) — AI 진행 상태 칩 다섯(답변·검토·막힘·작업 중·다음 회차 대기) + 완료(DONE, WP-396). state 가 없으면 「미완료」(진행 중 작업이 있는 이슈 전부).
 * 일시 중지·시작 전은 칩이 없어 URL 로 와도 무시한다(옛 값 WAITING 포함).
 */
export type QuickState = 'INPUT_REQUIRED' | 'REVIEW' | 'BLOCKED' | 'WORKING' | 'SCHEDULED' | 'DONE'

/** 칩 순서 — (미완료) 다음 내가 움직여야 하는 상태(답변·검토) 먼저, 다음 회차 대기는 작업 중 바로 뒤(AI 가 알아서 이어가는 상태), 완료는 미완료와 배타인 별도 보기라 맨 끝. */
export const QUICK_STATES: QuickState[] = ['INPUT_REQUIRED', 'REVIEW', 'BLOCKED', 'WORKING', 'SCHEDULED', 'DONE']

/** 칩 건수 키 — /me/ai-tasks/counts 응답 필드명(칩 testid 에도 쓴다). */
export type QuickCountKey = 'inputRequired' | 'review' | 'blocked' | 'working' | 'scheduled' | 'done'

/**
 * 칩별 표시·서버 대응 — label 은 칩 글자, countKey 는 건수 필드, agentState 는 목록 요청의 쉼표 구분 상태.
 * 막힘 칩은 BLOCKED 와 AUTH_REQUIRED(인증 필요)를 함께 본다 — 건수도 서버가 같은 합으로 준다.
 * 완료 칩은 종료 상태 넷을 함께 보낸다 — 서버는 진행 중 작업이 없고 종료 작업이 있는 이슈만 주고, 행 배지는 가장 최근 종료 결과다.
 */
export const QUICK_STATE_META: Record<QuickState, { label: string; countKey: QuickCountKey; agentState: string }> = {
  INPUT_REQUIRED: { label: AGENT_STATE_LABEL.INPUT_REQUIRED, countKey: 'inputRequired', agentState: 'INPUT_REQUIRED' },
  REVIEW: { label: AGENT_STATE_LABEL.REVIEW, countKey: 'review', agentState: 'REVIEW' },
  BLOCKED: { label: AGENT_STATE_LABEL.BLOCKED, countKey: 'blocked', agentState: 'BLOCKED,AUTH_REQUIRED' },
  WORKING: { label: AGENT_STATE_LABEL.WORKING, countKey: 'working', agentState: 'WORKING' },
  SCHEDULED: { label: AGENT_STATE_LABEL.SCHEDULED, countKey: 'scheduled', agentState: 'SCHEDULED' },
  DONE: { label: AGENT_STATE_LABEL.COMPLETED, countKey: 'done', agentState: TERMINAL_AGENT_STATES.join(',') },
}

/**
 * /me/ai-tasks 가 받는 facet — 이슈 상태·우선순위뿐이다. 내 작업 화면과 공유하는 마감(dueFrom/dueTo/dueDate)·막힘(blocked)은
 * 서버가 무시하므로 보내지도, "필터 걸림"으로 보지도 않는다(걸린 것처럼 보이는데 결과가 그대로인 혼란 방지).
 */
const AI_TASK_FACET_KEYS = ['status', 'priority'] as const

export interface AiTaskParams {
  /** 목록 요청 — facet + scope(+ 빠른 필터 agentState). */
  list: Record<string, string>
  /** 건수 요청 — 목록과 같되 agentState 제외(칩마다 자기 건수를 보여야 하므로). */
  counts: Record<string, string>
  /** 이 화면이 실제로 쓰는 facet(status/priority) — AI 화면 컨텍스트 facts 에도 이것만 싣는다. */
  facets: Record<string, string>
  /** 빠른 필터나 facet 이 걸려 있는지 — 빈 상태를 "조건에 맞는 작업 없음"으로 보일지. 범위는 필터로 보지 않는다. */
  filtered: boolean
  /** 완료 칩만 켠 보기(facet 없음) — 0건이면 조건 문구가 아니라 「아직 완료된 AI 작업이 없습니다」를 보인다(WP-917). */
  doneView: boolean
  /** 범위 — 없으면 나와 관련(mine). */
  scope: 'mine' | 'all'
  /** 켜진 빠른 필터 — 없으면 미완료(null). */
  state: QuickState | null
}

/** URL 을 읽어 목록·건수 요청 파라미터를 만든다. 모르는 값은 기본값으로 떨어뜨린다(잘못된 링크 방어). */
export function aiTaskParams(params: URLSearchParams): AiTaskParams {
  const scope = params.get('scope') === 'all' ? 'all' : 'mine'
  const raw = params.get('state')
  const state = QUICK_STATES.find((s) => s === raw) ?? null
  const all = meFacetParams(params)
  const facets: Record<string, string> = {}
  for (const key of AI_TASK_FACET_KEYS) if (all[key]) facets[key] = all[key]
  const counts = { ...facets, scope: scope === 'all' ? 'ALL' : 'MINE' }
  const list: Record<string, string> = state ? { ...counts, agentState: QUICK_STATE_META[state].agentState } : { ...counts }
  const hasFacets = Object.keys(facets).length > 0
  const filtered = state != null || hasFacets
  const doneView = state === 'DONE' && !hasFacets
  return { list, counts, facets, filtered, doneView, scope, state }
}
