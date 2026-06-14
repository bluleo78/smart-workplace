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
  if (filters.cycleIds.length) params.set('cycle', filters.cycleIds.join(','));
  if (filters.typeIds.length) params.set('type', filters.typeIds.join(','));
  // Phase 4a — parent / topLevel 직렬화. parent 가 지정되면 topLevel 은 무시(서버 우선순위와 정합).
  // topLevel 기본 true → 보드/목록은 상위 이슈만 요청. false(전체)면 미송신(백엔드 기본=전체). (#168)
  if (filters.parentNumber != null && filters.parentNumber > 0) {
    params.set('parent', String(filters.parentNumber));
  } else if (filters.topLevel) {
    params.set('topLevel', 'true');
  }
  // Phase 4b — blocked 검색 송신. UI 노출은 deferred.
  if (filters.blocked) params.set('blocked', 'true');
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
