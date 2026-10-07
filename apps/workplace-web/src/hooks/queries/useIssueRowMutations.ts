// 이슈 행·카드 「⋯」 메뉴(WP-273) 전용 단건 mutation — 우선순위·담당자·삭제.
// 상세 화면 훅(useUpdateIssueAssignees·useDeleteIssue)은 이슈 번호를 훅 인자로 받아 목록 한 곳에서 여러 행에 쓸 수 없고
// 낙관적 갱신도 없다. 메뉴는 목록·보드가 하나만 소유하므로 번호를 mutate 인자로 받고, 상태 변경(useUpdateIssueStatus)과 같은
// 「검색 캐시 패치 → 실패 시 복원 → settle 재조회」 흐름을 쓴다.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { replaceIssueAssignees } from '../../api/issueAssignees';
import { issuesApi } from '../../api/issues';
import { handleApiError } from '../../lib/api-error';
import type { IssuePriority } from '../../types/issue';
import type { UserSummary } from '../../types/user';
import { patchIssueInSearchCache } from './issueSearchCache';
import { invalidateIssueCaches } from './useBulkIssueActions';
import { issueKeys } from './useIssues';


/** 우선순위 변경 — 낙관적 패치. version 은 보내지 않는다(목록 행은 최신 version 을 보장하지 않음, 일괄 변경과 같은 정책). */
export function useUpdateIssuePriority(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ number, priority }: { number: number; priority: IssuePriority }) =>
      issuesApi.update(projectKey, number, { priority }),
    onMutate: ({ number, priority }) => patchIssueInSearchCache(qc, projectKey, number, { priority }),
    onError: (err, _vars, ctx) => {
      ctx?.restore();
      handleApiError(err, '우선순위 변경에 실패했습니다');
    },
    onSuccess: () => toast.success('우선순위를 변경했습니다'),
    onSettled: () => invalidateIssueCaches(qc, projectKey),
  });
}

/**
 * 담당자 집합 교체 — 낙관적 패치. 화면에 바로 그릴 UserSummary 를 함께 받는다(API 는 id 만 받는다).
 * successMessage 로 「AI에게 맡겼습니다」처럼 호출 의도에 맞는 토스트를 띄운다.
 */
export function useSetIssueAssignees(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    // 집합 교체 PUT 을 빠르게 연달아 토글하면 요청이 겹쳐 서버 적용 순서가 뒤바뀔 수 있다 — 같은 scope 는 차례로 보낸다.
    scope: { id: `issue-assignees-${projectKey}` },
    mutationFn: ({ number, assignees }: { number: number; assignees: UserSummary[]; successMessage?: string }) =>
      replaceIssueAssignees(projectKey, number, assignees.map((u) => u.id)),
    onMutate: ({ number, assignees }) => patchIssueInSearchCache(qc, projectKey, number, { assignees }),
    onError: (err, _vars, ctx) => {
      ctx?.restore();
      handleApiError(err, '담당자 변경에 실패했습니다');
    },
    onSuccess: (_data, { number, successMessage }) => {
      qc.invalidateQueries({ queryKey: ['watchers', projectKey, number] });
      toast.success(successMessage ?? '담당자를 변경했습니다');
    },
    onSettled: () => invalidateIssueCaches(qc, projectKey),
  });
}

/**
 * 단건 삭제 — 확인 다이얼로그 뒤에 호출한다. 행은 settle 재조회로 빠진다(낙관적 제거는 깜빡임, #881).
 * 상세 화면의 useDeleteIssue 는 번호를 훅 인자로 받아 목록이 여러 행에 쓸 수 없어 따로 둔다.
 * 지운 이슈의 상세 캐시는 재조회하면 404 오류 화면이 되므로 무효화 대신 제거한다.
 */
export function useRemoveIssue(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (number: number) => issuesApi.remove(projectKey, number),
    onSuccess: (_data, number) => {
      qc.removeQueries({ queryKey: issueKeys.detail(projectKey, number) });
      toast.success('태스크를 삭제했습니다');
    },
    onError: (e) => handleApiError(e, '태스크 삭제에 실패했습니다'),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
      qc.invalidateQueries({ queryKey: ['cycleProgress', projectKey] });
    },
  });
}
