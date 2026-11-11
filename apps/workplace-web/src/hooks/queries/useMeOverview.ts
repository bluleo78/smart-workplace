// 「내 작업 · 개요」(WP-1484) 조회 훅 — 개요 한 화면과 홈 위젯용 어제/오늘 요약, 업무 프로파일(WP-1485) 조회·다시 분석.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { analyzeWorkProfile, fetchMeOverview, fetchMeToday, fetchWorkProfile } from '../../api/meOverview'
import type { MeOverviewPeriod, MetricsGranularity } from '../../types/meOverview'

export const meOverviewKeys = {
  all: ['me-overview'] as const,
  overview: (period: MeOverviewPeriod, granularity: MetricsGranularity) => [...meOverviewKeys.all, period, granularity] as const,
  today: () => [...meOverviewKeys.all, 'today'] as const,
  workProfile: (period: MeOverviewPeriod) => [...meOverviewKeys.all, 'work-profile', period] as const,
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

/** 업무 프로파일 분석 중(PENDING)일 때 다시 읽는 간격 — 분석이 끝나면 멈춘다. */
const WORK_PROFILE_POLL_MS = 3000

/**
 * 업무 프로파일(WP-1485) — 기간마다 따로 캐시한다. PENDING 이면 3초마다 다시 읽어 끝난 결과로 바꾼다.
 * retry:false — 개요와 같은 방침으로 실패를 곧장 카드 안 다시 시도로 보인다.
 */
export function useWorkProfile(period: MeOverviewPeriod) {
  return useQuery({
    queryKey: meOverviewKeys.workProfile(period),
    queryFn: () => fetchWorkProfile(period),
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? WORK_PROFILE_POLL_MS : false),
  })
}

/** 「다시 분석」 — 응답에 실린 프로파일(STARTED 면 PENDING)로 캐시를 바로 바꿔, 카드가 곧장 분석 중으로 바뀌고 다시 읽기가 시작되게 한다. */
export function useAnalyzeWorkProfile(period: MeOverviewPeriod) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => analyzeWorkProfile(period),
    onSuccess: (res) => {
      queryClient.setQueryData(meOverviewKeys.workProfile(period), res.profile)
    },
  })
}
