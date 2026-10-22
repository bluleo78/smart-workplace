// DnD 전용 — 이슈 상태 변경 mutation.
// onMutate 에서 ['issues','search',projectKey] prefix 의 모든 InfiniteData 캐시를 패치하고,
// 실패 시 스냅샷 복원 + 토스트, 성공/실패 무관 onSettled 에서 무효화 동기화한다.
// closedHiding — 종료 이슈를 숨기는 화면이면, 바꾼 이슈가 숨겨질 때 성공 토스트에 이유와 「모두 보기」를 붙인다(WP-606).

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { updateIssueStatus } from '../../api/issues';
import { handleApiError } from '../../lib/api-error';
import type { ClosedHidingNotice } from '../../lib/closedHiding';
import type { IssueStatus } from '../../types/issue';
import { toastStatusChange } from './closedHidingToast';
import { copyIssueIntoStatusColumn, patchIssueInSearchCache } from './issueSearchCache';

export function useUpdateIssueStatus(projectKey: string, closedHiding?: ClosedHidingNotice) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ number, status }: { number: number; status: string }) =>
      updateIssueStatus(projectKey, number, status),
    // 진행 중인 검색 쿼리 취소 + 스냅샷 + 패치를 공용 헬퍼로 — 실패 시 restore() 로 되돌린다.
    // 보드 새 열 캐시에도 카드를 넣는다 — 이유는 copyIssueIntoStatusColumn(WP-860).
    onMutate: async ({ number, status }) => {
      const ctx = await patchIssueInSearchCache(qc, projectKey, number, { status: status as IssueStatus });
      copyIssueIntoStatusColumn(qc, projectKey, number, status);
      return ctx;
    },
    onError: (err, _vars, ctx) => {
      ctx?.restore();
      handleApiError(err, '태스크 상태 변경에 실패했습니다');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
    },
    onSuccess: (_res, { number, status }) => {
      void toastStatusChange(projectKey, [number], status, closedHiding, 'success', '상태를 변경했습니다');
    },
  });
}
