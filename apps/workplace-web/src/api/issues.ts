// 이슈 API 클라이언트.

import type {
  CreateIssueRequest,
  IssueAiClassifyResponse,
  IssueAiContext,
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
  // AI 현황 요약 온디맨드 생성 — 성공 시 최신 IssueAiContext 반환.
  generateAiSummary: (key: string, number: number) =>
    client.post<IssueAiContext>(`/projects/${key}/issues/${number}/ai-summary`),
  /** 이슈 AI 분류 제안 — 제목·본문 → 유형·우선순위·라벨·이유. DB 저장 없음. */
  aiClassify: (key: string, data: { title: string; body: string }) =>
    client.post<IssueAiClassifyResponse>(`/projects/${key}/issues/ai-classify`, data),
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
  // cycle — 사이클 id 목록 + 사이클 미할당('null' 토큰, assignee 의 미지정 토큰과 동일 패턴 · #878).
  const cycleTokens: string[] = [
    ...filters.cycleIds.map(String),
    ...(filters.cycleUnassigned ? ['null'] : []),
  ];
  if (cycleTokens.length) params.set('cycle', cycleTokens.join(','));
  if (filters.milestoneIds.length) params.set('milestone', filters.milestoneIds.join(','));
  if (filters.typeIds.length) params.set('type', filters.typeIds.join(','));
  // Phase 4a — parent / topLevel 직렬화. parent 가 지정되면 topLevel·excludeSubtasks·excludeEpics 는
  // 서버가 무시하므로 송신하지 않는다(서버 우선순위와 정합). false 는 미송신(백엔드 기본=전체). (#168)
  if (filters.parentNumber != null && filters.parentNumber > 0) {
    params.set('parent', String(filters.parentNumber));
  } else {
    if (filters.topLevel) params.set('topLevel', 'true');
    // SUBTASK 제외(에픽 자식은 유지) / EPIC 제외 — 보드·목록 기본 범위(withDefaultIssueScope)가 주입.
    if (filters.excludeSubtasks) params.set('excludeSubtasks', 'true');
    if (filters.excludeEpics) params.set('excludeEpics', 'true');
  }
  // 활성 사이클 밖 종료 이슈 숨김(#876) — 보드·목록 기본 범위(withDefaultIssueScope)가 주입.
  if (filters.hideInactiveClosed) params.set('hideInactiveClosed', 'true');
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

// 타임라인 간트의 의존 화살표용 프로젝트 전체 이슈 의존 엣지 (#620).
export interface DependencyEdge {
  fromIssueNumber: number;
  toIssueNumber: number;
}

export async function getProjectDependencyEdges(projectKey: string): Promise<DependencyEdge[]> {
  const { data } = await client.get<DependencyEdge[]>(
    `/projects/${projectKey}/issue-dependencies`,
  );
  return data;
}
