// 캘린더 오버레이용 — "내게 할당 + 마감일 보유" 이슈를 가시 범위로 조회.
// 백엔드 모듈 경계 유지를 위해 캘린더 API 가 아닌 이슈 API(/me/issues)로 조회 후 프론트에서 병합한다.
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'

import { fetchMeIssues } from '../../api/meIssues'
import type { IssueDueMarker } from '../../types/calendar'

// 6주(월 뷰) 범위라 단일 페이지로 충분 — 희귀하게 초과 시 표시 생략.
const MAX_DUES = 100

// from/to(ISO, 가시 범위)와 겹치는 내 이슈 마감일 마커를 조회한다.
export function useMyIssueDues(from: string, to: string, options?: { enabled?: boolean }) {
  // 백엔드 dueFrom/dueTo 는 LocalDate(yyyy-MM-dd) — ISO 범위를 날짜로 변환.
  const dueFrom = format(new Date(from), 'yyyy-MM-dd')
  const dueTo = format(new Date(to), 'yyyy-MM-dd')

  return useQuery<IssueDueMarker[]>({
    queryKey: ['my-issue-dues', dueFrom, dueTo],
    queryFn: async () => {
      const res = await fetchMeIssues({ assignee: 'me', dueFrom, dueTo }, null, MAX_DUES)
      return res.items
        .filter((i) => i.dueDate)
        .map((i) => ({
          issueId: i.id,
          projectKey: i.projectKey,
          number: i.number,
          title: i.title,
          dueDate: i.dueDate as string,
        }))
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  })
}
