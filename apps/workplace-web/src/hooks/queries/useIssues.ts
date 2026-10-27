// 이슈 생성 mutation + 캐시 키 헬퍼.
// 검색/목록 조회는 useIssueSearch (cursor 기반 무한 스크롤) 에서 담당한다.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { issuesApi } from '../../api/issues';
import { handleApiError } from '../../lib/api-error';
import type { CreateIssueRequest } from '../../types/issue';
import { refreshStatusesIfGone } from './useProjectStatuses';

export const issueKeys = {
  all: ['issues'] as const,
  search: (projectKey: string) => ['issues', 'search', projectKey] as const,
  /** 한 프로젝트의 모든 이슈 상세 접두사 — 프로젝트 단위로 상세를 무효화할 때. */
  details: (projectKey: string) => [...issueKeys.all, projectKey, 'detail'] as const,
  detail: (projectKey: string, number: number) =>
    [...issueKeys.details(projectKey), number] as const,
  // 이슈 하나의 하위 목록 접두사(WP-1039) — search 접두 아래라 프로젝트 검색 무효화에 함께 갱신된다. 화면은 에픽/하위 태스크 구분을 덧붙인다.
  children: (projectKey: string, number: number) => [...issueKeys.search(projectKey), 'children', number] as const,
  // 코멘트 하나의 반응자 목록 접두사(WP-504) — useReactors 가 이모지를 덧붙인다. 토글·SSE 가 이 접두사로 무효화.
  commentReactors: (commentId: number) => [...issueKeys.all, 'comment-reactors', commentId] as const,
};

export function useCreateIssue(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateIssueRequest) =>
      issuesApi.create(projectKey, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
    },
    // 처음 상태가 삭제돼 없으면(WP-936) 상태 목록을 다시 받는다 — 실패 토스트는 호출부(생성 폼)가 서버 문구로 띄운다.
    onError: (e) => {
      refreshStatusesIfGone(qc, projectKey, e);
    },
  });
}

// 이슈 soft-delete. 부모면 자식 SUBTASK 도 cascade (백엔드 처리).
// 권한: reporter 또는 OWNER. 성공 시 호출자가 라우팅 처리.
export function useDeleteIssue(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => issuesApi.remove(projectKey, number).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
      qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, number) });
      toast.success('태스크를 삭제했습니다');
    },
    onError: (e) => handleApiError(e, '태스크 삭제에 실패했습니다'),
  });
}
