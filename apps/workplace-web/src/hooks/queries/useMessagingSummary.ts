import { useQuery } from '@tanstack/react-query'

import { messagingSummaryApi } from '../../api/messagingSummary'

// 홈 대시보드 대화 요약 — 최근 대화 + 회신대기/안읽음 카운트. mail-summary 패턴 미러.
export function useMessagingSummary(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['messaging-summary'],
    queryFn: messagingSummaryApi.get,
    staleTime: 30_000,
    retry: false,
    enabled: options?.enabled ?? true,
  })
}
