// AI 위임 작업 「AI별」 보기(WP-1201) — 30초마다 다시 받는다(콜센터 현황판과 같은 갱신 주기).
// 연결 여부·작업 상태 변화는 이슈 변경 이벤트로 다 오지 않으므로 이슈 무효화('ai-tasks')에 묶지 않고 주기 갱신만 쓴다.
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { type AiAgentsResponse, fetchAiAgents } from '../../api/aiAgents'

export const AI_AGENTS_REFRESH_MS = 30_000

export function useAiAgents(scope: 'MINE' | 'ALL') {
  return useQuery<AiAgentsResponse, Error>({
    queryKey: ['ai-agents', scope],
    queryFn: () => fetchAiAgents(scope),
    placeholderData: keepPreviousData,
    refetchInterval: AI_AGENTS_REFRESH_MS,
  })
}
