import { useQuery } from '@tanstack/react-query'

import { mailSummaryApi } from '../../api/mailSummary'

// 홈 대시보드 메일 요약 — 안 읽은 수 + 최근 메일 일부.
// useDashboard/useNotifications 패턴과 동일하게 단순 useQuery 한 건.
//
// (준)실시간 갱신(#445): 백엔드가 3분 주기로 자동 동기화(#481)하므로 새 메일이
// 수동 sync 없이 DB 에 적재된다. 위젯이 이를 반영하도록 60초 폴링한다 — 새 메일의
// 신선도 상한이 어차피 3분 자동 동기화 주기이므로 SSE 푸시 대비 체감 차이가 없어
// 폴링으로 충분(비용·복잡도 최소). refetchIntervalInBackground 기본값(false)이라
// 탭이 숨겨진 동안에는 폴링하지 않는다.
export function useMailSummary(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['mail-summary'],
    queryFn: mailSummaryApi.get,
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: options?.enabled ?? true,
  })
}
