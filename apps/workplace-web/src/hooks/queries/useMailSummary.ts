import { useQuery } from '@tanstack/react-query'

import { mailSummaryApi } from '../../api/mailSummary'

// 홈 대시보드 메일 요약 — 안 읽은 수 + 최근 메일 일부.
// useDashboard/useNotifications 패턴과 동일하게 단순 useQuery 한 건.
export function useMailSummary() {
  return useQuery({
    queryKey: ['mail-summary'],
    queryFn: mailSummaryApi.get,
    staleTime: 30_000,
  })
}
