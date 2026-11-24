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

/** 내 차례를 다시 읽는 주기(ms) — 까닭은 useMyWorkflowTurns 주석. 내 작업 화면(탭 배지 포함)이 열려 있는 동안 돈다(WP-2042). */
export const MY_WORKFLOW_TURNS_REFETCH_MS = 30_000

/** 내 차례 — 모든 프로젝트에서 내가 담당인 활성 사람 노드(오래 기다린 순). */
export function useMyWorkflowTurns() {
  return useQuery({
    queryKey: workflowRunKeys.myTurns(),
    queryFn: ({ signal }) =>
      client.get<MyWorkflowTurnList>('/me/workflow-turns', { signal }).then((r) => r.data.items),
    // 남이 넘긴 차례는 이 화면이 모르는 변화다 — 전역 기본(staleTime 30초·포커스 재조회 끔)에 기대지 않고
    // 이 쿼리만 항상 낡은 것으로 보고, 탭에 돌아오면·열어 둔 동안 30초마다 다시 읽는다. 백그라운드 탭은 쉰다(WP-2042).
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: MY_WORKFLOW_TURNS_REFETCH_MS,
    refetchIntervalInBackground: false,
  })
}
