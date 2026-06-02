// 사이클 조회/CRUD + 진행 집계 + 이슈 사이클 교체.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  createCycle,
  deleteCycle,
  listCycleProgress,
  listCycles,
  listIssueCycles,
  replaceIssueCycles,
  updateCycle,
} from '../../api/cycles';
import { handleApiError } from '../../lib/api-error';
import type { CycleRequest } from '../../types/cycle';

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
      qc.invalidateQueries({ queryKey: ['cycles', projectKey] });
      qc.invalidateQueries({ queryKey: ['cycleProgress', projectKey] });
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
      qc.invalidateQueries({ queryKey: ['cycles', projectKey] });
      qc.invalidateQueries({ queryKey: ['cycleProgress', projectKey] });
      // 이슈 검색 결과도 무효화 — queryKey 접두사 매칭으로 전체 캐시 갱신.
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
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
