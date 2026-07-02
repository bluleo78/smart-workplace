import { useQuery } from '@tanstack/react-query'

import { priorityItemsApi } from '../../api/priorityItems'

// 홈 AI 우선순위 위젯 — 15분 주기 배치 결과를 읽기만 한다. staleTime 은 배치 주기보다 짧게(5분)
// 잡아 화면 진입 시 과도하게 오래된 데이터를 계속 보여주지 않으면서도 재조회 빈도는 낮춘다.
export function usePriorityItems() {
  return useQuery({
    queryKey: ['priority-items'],
    queryFn: priorityItemsApi.get,
    staleTime: 5 * 60_000,
    retry: false,
  })
}
