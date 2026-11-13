import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { getHelpMetrics, type HelpMetricDays, type HelpMetricKind } from '../../api/help'

/**
 * 도움말 측정 집계(WP-1512) — 종류(탭)·기간이 키라 바꾸면 다시 부른다. 관리자 전용 조회.
 * 집계는 일 단위라 1분간 신선하게 두어 탭을 오갈 때 다시 부르지 않고, 기간을 바꾸면 새 결과가 올 때까지 이전 표를 두어 깜빡임을 없앤다.
 */
export function useHelpMetrics(kind: HelpMetricKind, days: HelpMetricDays) {
  return useQuery({
    queryKey: ['help', 'metrics', kind, days],
    queryFn: () => getHelpMetrics(kind, days),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}
