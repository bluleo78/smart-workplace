// AI 현황 개요 훅(WP-1824) — 관리자 「AI 현황 › 개요」 화면의 서버 상태. 기간을 키로 두어 기간 전환 시 다시 부르고,
// 짧은 신선도·30초 자동 갱신으로 개요를 최신으로 유지한다.
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { type AiStatusPeriod, getAiStatusOverview } from '../../api/aiStatus'

/**
 * AI 현황 개요(WP-1824) — 기간이 키라 바꾸면 다시 부른다. 관리자 전용 조회로 30초마다 갱신한다(백그라운드 탭은 멈춘다).
 * 새 기간 결과가 올 때까지 이전 개요를 두어(keepPreviousData) 기간을 바꿔도 화면이 비지 않고 이어 그려진다.
 */
export function useAiStatusOverview(period: AiStatusPeriod) {
  return useQuery({
    queryKey: ['aiStatus', 'overview', period],
    queryFn: () => getAiStatusOverview(period),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  })
}