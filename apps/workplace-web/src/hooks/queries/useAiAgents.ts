// AI 위임 작업 「AI별」 보기(WP-1201) — 30초마다 다시 받는다(콜센터 현황판과 같은 갱신 주기).
// 연결 여부·작업 상태 변화는 이슈 변경 이벤트로 다 오지 않으므로 이슈 무효화('ai-tasks')에 묶지 않고 주기 갱신만 쓴다.
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { type AiAgentsResponse, fetchAiAgents } from '../../api/aiAgents'

export const AI_AGENTS_REFRESH_MS = 30_000

// 쿼리 키 한 곳(WP-1754) — 동시 진행 상한을 바꾼 뒤 AI별 막대를 다시 읽는 쪽(useSetAgentSlotLimit)이 같은 키를 쓴다.
export const aiAgentsKeys = {
  all: ['ai-agents'] as const,
  scope: (scope: 'MINE' | 'ALL') => ['ai-agents', scope] as const,
}

// enabled(WP-1754) — 관리 화면 상세처럼 필요할 때만 받으려는 곳이 끈다(기본 켜짐).
export function useAiAgents(scope: 'MINE' | 'ALL', enabled = true) {
  return useQuery<AiAgentsResponse, Error>({
    queryKey: aiAgentsKeys.scope(scope),
    queryFn: () => fetchAiAgents(scope),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: AI_AGENTS_REFRESH_MS,
  })
}
