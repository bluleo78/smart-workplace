// AI 위임 작업 화면의 URL → /me/ai-tasks 요청 파라미터 변환(WP-377).
// URL 이 단일 원본 — 범위(scope)·빠른 필터(state)·기존 facet(status/priority 등)을 모두 쿼리스트링으로 들고 다녀
// 새로고침·링크 공유에도 같은 화면이 나온다.
import { meFacetParams } from '../meFacetParams'

/** 빠른 필터 칩이 다루는 AI 진행 상태 — 일시 중지(PAUSED)는 칩이 없어 URL 로 와도 무시한다. */
export type QuickState = 'WAITING' | 'REVIEW' | 'BLOCKED' | 'WORKING'

/** 칩 순서 — 내가 움직여야 하는 상태(답변·검토) 먼저. */
export const QUICK_STATES: QuickState[] = ['WAITING', 'REVIEW', 'BLOCKED', 'WORKING']

export interface AiTaskParams {
  /** 목록 요청 — facet + scope(+ 빠른 필터 agentState). */
  list: Record<string, string>
  /** 건수 요청 — 목록과 같되 agentState 제외(칩마다 자기 건수를 보여야 하므로). */
  counts: Record<string, string>
  /** 범위 — 없으면 나와 관련(mine). */
  scope: 'mine' | 'all'
  /** 켜진 빠른 필터 — 없으면 전체(null). */
  state: QuickState | null
}

/** URL 을 읽어 목록·건수 요청 파라미터를 만든다. 모르는 값은 기본값으로 떨어뜨린다(잘못된 링크 방어). */
export function aiTaskParams(params: URLSearchParams): AiTaskParams {
  const scope = params.get('scope') === 'all' ? 'all' : 'mine'
  const raw = params.get('state')
  const state = QUICK_STATES.find((s) => s === raw) ?? null
  const counts = { ...meFacetParams(params), scope: scope === 'all' ? 'ALL' : 'MINE' }
  const list: Record<string, string> = state ? { ...counts, agentState: state } : { ...counts }
  return { list, counts, scope, state }
}
