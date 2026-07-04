// 마일스톤 API 클라이언트 — 프로젝트 스코프 CRUD.

import type { MilestoneRequest, MilestoneResponse } from '../types/milestone';
import { client } from './client';

// 프로젝트의 마일스톤 전체 목록 (읽기 권한).
export async function listMilestones(projectKey: string): Promise<MilestoneResponse[]> {
  const { data } = await client.get<MilestoneResponse[]>(`/projects/${projectKey}/milestones`);
  return data;
}

// 멤버 권한 — 신규 마일스톤 생성.
export async function createMilestone(
  projectKey: string,
  body: MilestoneRequest,
): Promise<MilestoneResponse> {
  const { data } = await client.post<MilestoneResponse>(
    `/projects/${projectKey}/milestones`,
    body,
  );
  return data;
}

// 멤버 권한 — 마일스톤 수정.
export async function updateMilestone(
  projectKey: string,
  id: number,
  body: MilestoneRequest,
): Promise<MilestoneResponse> {
  const { data } = await client.patch<MilestoneResponse>(
    `/projects/${projectKey}/milestones/${id}`,
    body,
  );
  return data;
}

// 멤버 권한 — 마일스톤 삭제 (이슈 연결은 milestoneId null 로 해제).
export async function deleteMilestone(projectKey: string, id: number): Promise<void> {
  await client.delete<void>(`/projects/${projectKey}/milestones/${id}`);
}
