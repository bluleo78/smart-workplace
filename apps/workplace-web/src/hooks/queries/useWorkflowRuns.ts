// 워크플로우 실행 조회 서버 상태 훅 — 정의의 실행 목록·상세·노드별 진행 수·내 차례(WP-1991). 타입·순수 함수는 lib/workflowRuns.ts.
import { keepPreviousData, skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { client } from '@/api/client'
import type { MyWorkflowTurnList, RunFilters, WorkflowRunCounts, WorkflowRunDetail, WorkflowRunPage } from '@/lib/workflowRuns'

import { workflowRunKeys } from './workflowRunKeys'

/** 실행 목록 — cursor 로 다음 쪽을 이어 읽는다. 정의를 고르기 전·enabled 가 false 일 때(그래프 모아 보기)는 묻지 않는다. */
export function useWorkflowRuns(workflowId: number | undefined, filters: RunFilters, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: workflowRunKeys.list(workflowId, filters),
    initialPageParam: null as string | null,
    queryFn:
      !enabled || workflowId == null
        ? skipToken
        : ({ pageParam, signal }) =>
            client
              .get<WorkflowRunPage>(`/workflows/${workflowId}/runs`, {
                params: { ...filters, cursor: pageParam ?? undefined, size: 30 },
                signal,
              })
              .then((r) => r.data),
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  })
}

/** 실행 한 건의 상세 — 고른 실행이 없으면 묻지 않는다. */
export function useWorkflowRun(runId: number | null) {
  return useQuery({
    queryKey: workflowRunKeys.detail(runId),
    queryFn:
      runId == null
        ? skipToken
        : ({ signal }) => client.get<WorkflowRunDetail>(`/workflow-runs/${runId}`, { signal }).then((r) => r.data),
  })
}

/** 노드별 진행 중 실행 수(그래프 배지) — 「그래프에 모아 보기」일 때만 묻는다. */
export function useWorkflowRunCounts(workflowId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: workflowRunKeys.counts(workflowId),
    queryFn:
      enabled && workflowId != null
        ? ({ signal }) =>
            client
              .get<WorkflowRunCounts>(`/workflows/${workflowId}/run-counts`, { signal })
              .then((r) => r.data.counts)
        : skipToken,
  })
}

/** 내 차례 — 모든 프로젝트에서 내가 담당인 활성 사람 노드(오래 기다린 순). */
export function useMyWorkflowTurns() {
  return useQuery({
    queryKey: workflowRunKeys.myTurns(),
    queryFn: ({ signal }) =>
      client.get<MyWorkflowTurnList>('/me/workflow-turns', { signal }).then((r) => r.data.items),
  })
}
