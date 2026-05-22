// 이슈 API 클라이언트.

import type { PageResponse } from '../types/common';
import type {
  CreateIssueRequest,
  IssueDetailResponse,
  IssueResponse,
  UpdateIssueRequest,
} from '../types/issue';
import { client } from './client';

export const issuesApi = {
  list: (key: string, params: { page?: number; size?: number } = {}) =>
    client.get<PageResponse<IssueResponse>>(`/projects/${key}/issues`, { params }),
  create: (key: string, data: CreateIssueRequest) =>
    client.post<IssueResponse>(`/projects/${key}/issues`, data),
  get: (key: string, number: number) =>
    client.get<IssueDetailResponse>(`/projects/${key}/issues/${number}`),
  update: (key: string, number: number, data: UpdateIssueRequest) =>
    client.patch<IssueDetailResponse>(`/projects/${key}/issues/${number}`, data),
  remove: (key: string, number: number) =>
    client.delete<void>(`/projects/${key}/issues/${number}`),
};
