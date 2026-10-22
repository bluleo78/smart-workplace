// 이슈 댓글 API 클라이언트 — 댓글은 issueId 기반 글로벌 경로(/issues/{id}/comments) 사용.

import type {
  CreateCommentRequest,
  IssueCommentResponse,
  UpdateCommentRequest,
} from '../types/issue';
import type { ReactorPage } from '../types/messaging';
import { client } from './client';

export const issueCommentsApi = {
  list: (issueId: number) => client.get<IssueCommentResponse[]>(`/issues/${issueId}/comments`),
  create: (issueId: number, data: CreateCommentRequest) =>
    client.post<IssueCommentResponse>(`/issues/${issueId}/comments`, data),
  update: (issueId: number, commentId: number, data: UpdateCommentRequest) =>
    client.patch<IssueCommentResponse>(`/issues/${issueId}/comments/${commentId}`, data),
  remove: (issueId: number, commentId: number) =>
    client.delete<void>(`/issues/${issueId}/comments/${commentId}`),

  // 코멘트 이모지 반응 추가·취소(WP-504) — 둘 다 204. 이미 있는/없는 반응은 서버가 멱등 처리.
  addReaction: (issueId: number, commentId: number, emoji: string) =>
    client
      .post(`/issues/${issueId}/comments/${commentId}/reactions`, { emoji })
      .then(() => undefined),
  removeReaction: (issueId: number, commentId: number, emoji: string) =>
    client
      .delete(`/issues/${issueId}/comments/${commentId}/reactions?emoji=${encodeURIComponent(emoji)}`)
      .then(() => undefined),

  // 이모지별 반응자 페이지(WP-504) — 호버·전체 보기 때만 부른다. cursor 가 없으면 첫 페이지.
  listReactors: (issueId: number, commentId: number, emoji: string, cursor?: string, limit = 20) => {
    const params = new URLSearchParams({ emoji, limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return client.get<ReactorPage>(
      `/issues/${issueId}/comments/${commentId}/reactions/users?${params.toString()}`,
    );
  },
};
