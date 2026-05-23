// 이슈 API 클라이언트.

import type {
  CreateIssueRequest,
  IssueDetailResponse,
  IssueFilters,
  IssueResponse,
  IssueSearchResponse,
  UpdateIssueRequest,
} from '../types/issue';
import { client } from './client';

// 검색/목록 조회는 searchIssues 가 단일 진입점이다 (cursor 페이지네이션).
export const issuesApi = {
  create: (key: string, data: CreateIssueRequest) =>
    client.post<IssueResponse>(`/projects/${key}/issues`, data),
  get: (key: string, number: number) =>
    client.get<IssueDetailResponse>(`/projects/${key}/issues/${number}`),
  update: (key: string, number: number, data: UpdateIssueRequest) =>
    client.patch<IssueDetailResponse>(`/projects/${key}/issues/${number}`, data),
  remove: (key: string, number: number) =>
    client.delete<void>(`/projects/${key}/issues/${number}`),
};

// 이슈 검색 — cursor 페이지네이션 + 필터 단일 엔드포인트.
// IssueFilters 를 백엔드가 받는 쿼리 파라미터 표현으로 직렬화한다.
export async function searchIssues(
  projectKey: string,
  filters: IssueFilters,
  cursor: string | null,
  size = 30,
): Promise<IssueSearchResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.statuses.length) params.set('status', filters.statuses.join(','));
  if (filters.priorities.length) params.set('priority', filters.priorities.join(','));
  const assigneeTokens: string[] = [
    ...filters.assigneeIds.map(String),
    ...(filters.includeUnassigned ? ['null'] : []),
  ];
  if (assigneeTokens.length) params.set('assignee', assigneeTokens.join(','));
  if (filters.dueFrom) params.set('dueFrom', filters.dueFrom);
  if (filters.dueTo) params.set('dueTo', filters.dueTo);
  if (filters.labelIds.length) params.set('label', filters.labelIds.join(','));
  if (cursor) params.set('cursor', cursor);
  params.set('size', String(size));
  const { data } = await client.get<IssueSearchResponse>(
    `/projects/${projectKey}/issues?${params.toString()}`,
  );
  return data;
}

// DnD 전용 — status 만 변경. 응답은 갱신된 IssueDetailResponse.
export async function updateIssueStatus(
  projectKey: string,
  number: number,
  status: string,
): Promise<IssueDetailResponse> {
  const { data } = await client.patch<IssueDetailResponse>(
    `/projects/${projectKey}/issues/${number}/status`,
    { status },
  );
  return data;
}
