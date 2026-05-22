// 이슈 댓글 API 클라이언트 — 댓글은 issueId 기반 글로벌 경로(/issues/{id}/comments) 사용.

import type {
  CreateCommentRequest,
  IssueCommentResponse,
  UpdateCommentRequest,
} from '../types/issue';
import { client } from './client';

export const issueCommentsApi = {
  list: (issueId: number) => client.get<IssueCommentResponse[]>(`/issues/${issueId}/comments`),
  create: (issueId: number, data: CreateCommentRequest) =>
    client.post<IssueCommentResponse>(`/issues/${issueId}/comments`, data),
  update: (issueId: number, commentId: number, data: UpdateCommentRequest) =>
    client.patch<IssueCommentResponse>(`/issues/${issueId}/comments/${commentId}`, data),
  remove: (issueId: number, commentId: number) =>
    client.delete<void>(`/issues/${issueId}/comments/${commentId}`),
};
