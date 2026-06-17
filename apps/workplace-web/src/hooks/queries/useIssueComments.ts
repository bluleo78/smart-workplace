// 이슈 댓글 mutation 훅 — 성공 시 이슈 detail 쿼리를 무효화해 코멘트 목록 갱신.

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { issueCommentsApi } from '../../api/issueComments';
import type { CreateCommentRequest, UpdateCommentRequest } from '../../types/issue';
import { issueKeys } from './useIssues';

export function useCreateComment(projectKey: string, issueNumber: number, issueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCommentRequest) =>
      issueCommentsApi.create(issueId, data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, issueNumber) }); },
  });
}

export function useUpdateComment(projectKey: string, issueNumber: number, issueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { commentId: number; data: UpdateCommentRequest }) =>
      issueCommentsApi.update(issueId, params.commentId, params.data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, issueNumber) }); },
  });
}

export function useDeleteComment(projectKey: string, issueNumber: number, issueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: number) => issueCommentsApi.remove(issueId, commentId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, issueNumber) }); },
  });
}
