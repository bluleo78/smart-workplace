// AI 처리 이력 훅(WP-1825) — 관리자 「AI 현황 › 처리 이력」의 서버 상태. 목록은 커서 무한 스크롤, 상세는 행을 눌렀을 때만 부른다.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { type AiRunsParams, getAiStatusRunDetail, getAiStatusRuns } from '../../api/aiStatus'

/**
 * 처리 이력 목록 — 서버가 준 nextCursor 로 다음 페이지를 이어 붙인다(커서가 없으면 마지막).
 * gcTime 0: 감사 로그와 같은 까닭(WP-183) — 무한 쿼리는 재조회 때 받아 둔 페이지를 전부 다시 받으므로 화면을 떠나면 캐시를 버린다.
 */
export function useAiStatusRuns(params: AiRunsParams, size = 50) {
  return useInfiniteQuery({
    queryKey: ['aiStatusRuns', params, size],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getAiStatusRuns({ ...params, cursor: pageParam, size }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    gcTime: 0,
    // 창 포커스 때 다시 받지 않는다 — 페이지를 많이 받은 뒤 탭에 돌아올 때마다 받은 페이지를 전부 차례로 다시 받는 비용이 크고,
    // 기간 조회의 기준 시각(from)이 낡은 채 다시 받아 화면 조건과 어긋나기 때문.
    refetchOnWindowFocus: false,
  })
}

/** 처리 상세 — runId 가 null(선택 없음)이면 부르지 않는다. */
export function useAiStatusRunDetail(runId: string | null) {
  return useQuery({
    queryKey: ['aiStatusRunDetail', runId],
    queryFn: () => getAiStatusRunDetail(runId as string),
    enabled: runId != null,
  })
}
