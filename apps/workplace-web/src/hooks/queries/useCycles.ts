// 사이클 조회/CRUD + 진행 집계 + 이슈 사이클 교체.

import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  completeCycle,
  createCycle,
  deleteCycle,
  listCycleProgress,
  listCycles,
  listIssueCycles,
  replaceIssueCycles,
  updateCycle,
} from '../../api/cycles';
import { handleApiError } from '../../lib/api-error';
import type { CycleCompleteRequest, CycleRequest } from '../../types/cycle';

// 프로젝트 사이클 전체 목록.
export function useCycles(projectKey: string) {
  return useQuery({
    queryKey: ['cycles', projectKey],
    queryFn: () => listCycles(projectKey),
    enabled: !!projectKey,
  });
}

// 프로젝트 사이클 진행 집계.
export function useCycleProgress(projectKey: string) {
  return useQuery({
    queryKey: ['cycleProgress', projectKey],
    queryFn: () => listCycleProgress(projectKey),
    enabled: !!projectKey,
  });
}

/**
 * 사이클 목록·진행 집계·이슈 검색 캐시를 함께 무효화한다 — 사이클 수정·삭제·완료가 같은 세 가지를 갱신해야 해서 한 곳에 둔다.
 * 검색까지 무효화하는 것은 사이클 상태(ACTIVE 전환·종료)·연결이 보드·목록의 종료 이슈 노출 범위를 바꾸기 때문(#876) — queryKey 접두사 매칭으로 전체 갱신.
 * 사이클 생성은 검색에 영향이 없어 이 함수를 쓰지 않는다.
 */
function invalidateCycleCaches(qc: QueryClient, projectKey: string) {
  qc.invalidateQueries({ queryKey: ['cycles', projectKey] });
  qc.invalidateQueries({ queryKey: ['cycleProgress', projectKey] });
  qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
}

export function useCreateCycle(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CycleRequest) => createCycle(projectKey, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cycles', projectKey] });
      qc.invalidateQueries({ queryKey: ['cycleProgress', projectKey] });
      toast.success('사이클을 생성했습니다');
    },
    onError: (e) => handleApiError(e, '사이클 생성에 실패했습니다'),
  });
}

export function useUpdateCycle(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; body: CycleRequest }) => updateCycle(projectKey, v.id, v.body),
    onSuccess: () => {
      invalidateCycleCaches(qc, projectKey);
      toast.success('사이클을 수정했습니다');
    },
    onError: (e) => handleApiError(e, '사이클 수정에 실패했습니다'),
  });
}

export function useDeleteCycle(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteCycle(projectKey, id),
    onSuccess: () => {
      invalidateCycleCaches(qc, projectKey);
      toast.success('사이클을 삭제했습니다');
    },
    onError: (e) => handleApiError(e, '사이클 삭제에 실패했습니다'),
  });
}

// 이슈에 연결된 사이클 (피커 초기값).
export function useIssueCycles(projectKey: string, issueNumber: number) {
  return useQuery({
    queryKey: ['issueCycles', projectKey, issueNumber],
    queryFn: () => listIssueCycles(projectKey, issueNumber),
    enabled: !!projectKey && !!issueNumber,
  });
}

// 이슈 사이클 집합 교체.
export function useUpdateIssueCycles(projectKey: string, issueNumber: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cycleIds: number[]) => replaceIssueCycles(projectKey, issueNumber, cycleIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issueCycles', projectKey, issueNumber] });
      qc.invalidateQueries({ queryKey: ['cycleProgress', projectKey] });
      // 이슈 검색 결과도 무효화 — queryKey 접두사 매칭으로 전체 캐시 갱신.
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      toast.success('사이클을 변경했습니다');
    },
    onError: (e) => handleApiError(e, '사이클 변경에 실패했습니다'),
  });
}

// 사이클 완료. 다른 변경 훅과 달리 onError 에서 토스트(handleApiError)를 띄우지 않는다 —
// 완료 창이 열려 있는 동안 서버의 400/409 한국어 메시지를 창 안에 인라인으로 보여주기 때문(중복 알림 방지).
export function useCompleteCycle(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { cycleId: number; body: CycleCompleteRequest }) =>
      completeCycle(projectKey, v.cycleId, v.body),
    // 이슈의 사이클 연결·종료 이슈 노출 범위가 바뀌므로 검색 캐시까지 무효화한다.
    onSuccess: () => invalidateCycleCaches(qc, projectKey),
  });
}
