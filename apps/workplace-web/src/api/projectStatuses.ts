// 프로젝트 상태(Project Status) API 클라이언트 (WP-808).
// 목록은 멤버 누구나, 추가·이름 변경은 OWNER 만(개인 프로젝트는 서버가 400). 삭제·범주 변경은 없다.

import type { IssueStatus } from '../types/issue';
import type { ProjectStatus } from '../types/projectStatus';
import { client } from './client';

/** 상태 추가 본문 — afterStatusId 가 있으면 그 상태 바로 뒤, 없으면 범주의 맨 뒤에 넣는다. */
export interface CreateProjectStatusBody {
  name: string;
  category: IssueStatus;
  afterStatusId?: number;
}

/** 이름 변경 본문 — 범주·순서는 바꾸지 않는다. */
export interface RenameProjectStatusBody {
  name: string;
}

// 프로젝트의 상태 목록 — 서버가 범주 순서 → position 으로 정렬해 준다.
export async function listProjectStatuses(projectKey: string): Promise<ProjectStatus[]> {
  const { data } = await client.get<ProjectStatus[]>(`/projects/${projectKey}/statuses`);
  return data;
}

export async function createProjectStatus(
  projectKey: string,
  body: CreateProjectStatusBody,
): Promise<ProjectStatus> {
  const { data } = await client.post<ProjectStatus>(`/projects/${projectKey}/statuses`, body);
  return data;
}

export async function renameProjectStatus(
  projectKey: string,
  id: number,
  body: RenameProjectStatusBody,
): Promise<ProjectStatus> {
  const { data } = await client.patch<ProjectStatus>(`/projects/${projectKey}/statuses/${id}`, body);
  return data;
}
