// 「내 작업 · 개요」(WP-1484) 조회 훅 — 개요 한 화면과 홈 위젯용 어제/오늘 요약.
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { fetchMeOverview, fetchMeToday } from '../../api/meOverview'
import type { MeOverviewPeriod, MetricsGranularity } from '../../types/meOverview'

export const meOverviewKeys = {
  all: ['me-overview'] as const,
  overview: (period: MeOverviewPeriod, granularity: MetricsGranularity) => [...meOverviewKeys.all, period, granularity] as const,
  today: () => [...meOverviewKeys.all, 'today'] as const,
}

/**
 * 개요 한 화면 — 기간·칸 단위를 바꾸는 동안 앞 결과를 그대로 보여 화면이 스켈레톤으로 깜빡이지 않게 한다(keepPreviousData).
 * retry:false — 실패를 곧장 다시 시도 안내로 보인다(홈 위젯과 같은 방침, #205).
 */
export function useMeOverview(period: MeOverviewPeriod, granularity: MetricsGranularity) {
  return useQuery({
    queryKey: meOverviewKeys.overview(period, granularity),
    queryFn: () => fetchMeOverview(period, granularity),
    placeholderData: keepPreviousData,
    retry: false,
  })
}

/** 어제/오늘 요약 — 홈 「내 작업」 위젯 한 줄. 미리보기(카탈로그)에서는 부르지 않는다. */
export function useMeToday(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: meOverviewKeys.today(),
    queryFn: fetchMeToday,
    retry: false,
    enabled: options?.enabled ?? true,
  })
}
