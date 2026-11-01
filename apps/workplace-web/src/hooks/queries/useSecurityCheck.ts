// WP-1262: HTML 파일 AI 보안 점검 조회·요청 훅.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { securityCheckApi } from '../../api/securityCheck'
import { isSummaryPollingExhausted } from '../../lib/driveSummary'
import type { SecurityCheckView } from '../../types/securityCheck'
import { useAiAvailable } from '../useAiAvailable'

const POLL_INTERVAL_MS = 3000

/**
 * 점검 결과 구독 — path 가 있고 enabled(스크립트가 든 문서)이고 AI 사용 가능일 때만 조회한다.
 * 진행 중(PENDING/CHECKING)이면 3초 간격 폴링, 상한은 「요청 세대 이후 받은 횟수」 IN_PROGRESS_POLLS 회.
 * dataUpdateCount 를 그대로 쓰면 상한에 닿은 뒤 「다시 점검」해도 이미 상한이라 폴링이 다시 돌지 않는다 —
 * request 가 POST 응답을 캐시에 넣을 때 그 시점의 횟수를 기준(base)으로 기억해, 그 뒤 받은 횟수만 센다.
 */
export function useSecurityCheck(path: string | undefined, enabled: boolean) {
  const aiAvailable = useAiAvailable()
  const client = useQueryClient()
  const queryKey = ['security-check', path] as const
  // 요청 세대 기준 횟수 — 같은 경로를 보는 모든 observer(안내 줄·패널 카드·가용성 판정)가 공유해야 하므로 쿼리 캐시에 둔다.
  // 인스턴스별 state 면 늦게 열린 카드가 상한만큼 더 폴링하고, 한쪽에서 「다시 점검」해도 다른 쪽 상한이 안 풀려 화면이 어긋난다.
  // 처음 만들어질 때 값 = 그때 캐시에 쌓인 횟수(닫았다 다시 열어도 이전 횟수가 합산돼 상한이 줄지 않게). queryFn 은 쓰지 않는다(enabled false).
  const baseKey = ['security-check-base', path] as const
  const baseQuery = useQuery({
    queryKey: baseKey,
    queryFn: () => 0,
    enabled: false,
    staleTime: Infinity,
    initialData: () => client.getQueryState(queryKey)?.dataUpdateCount ?? 0,
  })
  const baseCount = baseQuery.data ?? 0

  const query = useQuery({
    queryKey,
    queryFn: async () => (await securityCheckApi.get(path as string)).data,
    enabled: !!path && enabled && aiAvailable,
    retry: false,
    refetchInterval: (q) => {
      const status = q.state.data?.status
      if (status !== 'PENDING' && status !== 'CHECKING') return false
      return isSummaryPollingExhausted(q.state.dataUpdateCount - baseCount) ? false : POLL_INTERVAL_MS
    },
  })

  const mutation = useMutation({
    mutationFn: async () => (await securityCheckApi.request(path as string)).data,
    // POST 가 실패하면 저장된 상태를 다시 읽어 화면을 서버와 맞춘다(그래도 오류면 실패 칩).
    onError: () => {
      void query.refetch()
    },
    onSuccess: (data: SecurityCheckView) => {
      // setQueryData 가 dataUpdateCount 를 1 올리므로 올린 뒤 값을 기준으로 잡는다 — 그 응답은 세지 않는다.
      const next = (client.getQueryState(queryKey)?.dataUpdateCount ?? 0) + 1
      client.setQueryData(baseKey, next)
      client.setQueryData(queryKey, data)
    },
  })

  // 같은 내용의 응답은 data 참조가 그대로라 재렌더가 없다 — dataUpdatedAt 을 읽어 받을 때마다 구독해 상한 판정이 갱신되게 한다.
  void query.dataUpdatedAt
  const updates = client.getQueryState(queryKey)?.dataUpdateCount ?? 0
  return {
    view: query.data,
    isLoading: query.isLoading,
    pollingExhausted: isSummaryPollingExhausted(updates - baseCount),
    request: () => {
      if (path) mutation.mutate()
    },
    requesting: mutation.isPending,
    errored: query.isError || mutation.isError,
  }
}
