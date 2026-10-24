// 프로젝트 상태(Project Status) API 클라이언트 (WP-808·WP-809).
// 목록은 멤버 누구나, 추가·수정(이름·색)·순서 변경·삭제는 OWNER 만(개인 프로젝트는 서버가 400). 범주 변경은 없다.

import type { IssueStatus } from '../types/issue';
import type { ColorToken } from '../types/label';
import type { ProjectStatus, StatusDeletionImpact } from '../types/projectStatus';
import { client } from './client';

/** 상태 추가 본문 — afterStatusId 가 있으면 그 상태 바로 뒤, 없으면 범주의 맨 뒤에 넣는다. 색이 없으면 서버가 범주 기본 색. */
export interface CreateProjectStatusBody {
  name: string;
  category: IssueStatus;
  afterStatusId?: number;
  color?: ColorToken;
}

/** 수정 본문 — 이름·색 중 보낸 것만 바꾼다. 범주·순서는 바꾸지 않는다. */
export interface UpdateProjectStatusBody {
  name?: string;
  color?: ColorToken;
}

/** 순서 변경 본문 — 한 범주의 상태 id 전체를 새 순서로. 다른 범주 위치는 그대로다. */
export interface ReorderProjectStatusesBody {
  category: IssueStatus;
  statusIds: number[];
}

// 프로젝트의 상태 목록 — 서버가 범주 순서 → position 으로 정렬해 준다.
export async function listProjectStatuses(projectKey: string): Promise<ProjectStatus[]> {
  const { data } = await client.get<ProjectStatus[]>(`/projects/${projectKey}/statuses`);
  return data;
}

// 상태 추가 — 상한(20) 이면 409 「상태는 프로젝트당 20개까지 만들 수 있어요」.
export async function createProjectStatus(
  projectKey: string,
  body: CreateProjectStatusBody,
): Promise<ProjectStatus> {
  const { data } = await client.post<ProjectStatus>(`/projects/${projectKey}/statuses`, body);
  return data;
}

// 상태 이름·색 수정.
export async function updateProjectStatus(
  projectKey: string,
  id: number,
  body: UpdateProjectStatusBody,
): Promise<ProjectStatus> {
  const { data } = await client.patch<ProjectStatus>(`/projects/${projectKey}/statuses/${id}`, body);
  return data;
}

// 같은 범주 안 순서 변경 — 응답은 바뀐 전체 상태 목록(표시 순서).
export async function reorderProjectStatuses(
  projectKey: string,
  body: ReorderProjectStatusesBody,
): Promise<ProjectStatus[]> {
  const { data } = await client.put<ProjectStatus[]>(`/projects/${projectKey}/statuses/order`, body);
  return data;
}

// 삭제 전 영향 — 삭제 창이 이슈 수·저장된 뷰·에픽 차단을 보인다.
export async function getStatusDeletionImpact(projectKey: string, id: number): Promise<StatusDeletionImpact> {
  const { data } = await client.get<StatusDeletionImpact>(`/projects/${projectKey}/statuses/${id}/deletion-impact`);
  return data;
}

// 상태 삭제 — 이슈가 있으면 moveTo(옮길 상태)가 필요하다. 범주의 마지막 상태면 409 「범주의 마지막 상태는 지울 수 없어요」.
export async function deleteProjectStatus(projectKey: string, id: number, moveTo?: number): Promise<void> {
  await client.delete(`/projects/${projectKey}/statuses/${id}`, {
    params: moveTo != null ? { moveTo } : undefined,
  });
}
