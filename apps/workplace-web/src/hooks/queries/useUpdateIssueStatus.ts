// DnD 전용 — 이슈 상태 변경 mutation.
// onMutate 에서 ['issues','search',projectKey] prefix 의 모든 InfiniteData 캐시를 패치하고,
// 실패 시 스냅샷 복원 + 토스트, 성공/실패 무관 onSettled 에서 무효화 동기화한다.

import {
  type InfiniteData,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { updateIssueStatus } from '../../api/issues';
import { handleApiError } from '../../lib/api-error';
import type { IssueSearchResponse, IssueStatus } from '../../types/issue';

export function useUpdateIssueStatus(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ number, status }: { number: number; status: string }) =>
      updateIssueStatus(projectKey, number, status),
    onMutate: async ({ number, status }) => {
      // 진행 중인 검색 쿼리를 잠시 멈춰 캐시 덮어쓰기를 방지.
      await qc.cancelQueries({ queryKey: ['issues', 'search', projectKey] });
      const snapshots = qc.getQueriesData<InfiniteData<IssueSearchResponse>>({
        queryKey: ['issues', 'search', projectKey],
      });
      qc.setQueriesData<InfiniteData<IssueSearchResponse>>(
        { queryKey: ['issues', 'search', projectKey] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              items: p.items.map((it) =>
                it.number === number ? { ...it, status: status as IssueStatus } : it,
              ),
            })),
          };
        },
      );
      return { snapshots };
    },
    onError: (err, _vars, ctx) => {
      // 낙관적 패치를 모두 되돌린다.
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      handleApiError(err, '태스크 상태 변경에 실패했습니다');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
    },
    onSuccess: () => {
      toast.success('상태를 변경했습니다');
    },
  });
}
