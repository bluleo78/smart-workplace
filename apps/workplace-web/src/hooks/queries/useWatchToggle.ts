// 이슈 watcher 조회 + 구독/해제 mutation.
// currentUserId 는 상위 컴포넌트에서 내려준다 — 본인이 watch 중인지 판별에 사용.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { listWatchers, unwatchIssue, watchIssue } from '../../api/watchers';
import { handleApiError } from '../../lib/api-error';

export function useWatchers(projectKey: string, number: number) {
  return useQuery({
    queryKey: ['watchers', projectKey, number],
    queryFn: () => listWatchers(projectKey, number),
    enabled: !!projectKey && Number.isFinite(number),
  });
}

export function useWatchToggle(
  projectKey: string,
  number: number,
  // 현재 사용자 id — 추후 optimistic update 등 확장에 대비해 받지만 현재는 invalidate 만.
  _currentUserId: number | null,
) {
  void _currentUserId;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: boolean) =>
      next ? watchIssue(projectKey, number) : unwatchIssue(projectKey, number),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchers', projectKey, number] });
      qc.invalidateQueries({ queryKey: ['watched-issues'] });
    },
    onError: (e) => {
      toast.dismiss();
      handleApiError(e, '구독 상태를 변경하지 못했습니다');
    },
  });
}
