// 라벨 API 클라이언트 — 프로젝트 CRUD + 이슈 라벨 집합 교체.

import type { LabelResponse, LabelSummary } from '../types/label';
import { client } from './client';

// 프로젝트의 라벨 전체 목록 (멤버 권한).
export async function listLabels(projectKey: string): Promise<LabelResponse[]> {
  const { data } = await client.get<LabelResponse[]>(`/projects/${projectKey}/labels`);
  return data;
}

// OWNER 전용 — 신규 라벨 생성.
export async function createLabel(
  projectKey: string,
  body: { name: string; colorToken: string },
): Promise<LabelResponse> {
  const { data } = await client.post<LabelResponse>(`/projects/${projectKey}/labels`, body);
  return data;
}

// OWNER 전용 — 이름/색상 변경.
export async function updateLabel(
  projectKey: string,
  id: number,
  body: { name: string; colorToken: string },
): Promise<LabelResponse> {
  const { data } = await client.patch<LabelResponse>(`/projects/${projectKey}/labels/${id}`, body);
  return data;
}

// OWNER 전용 — 라벨 삭제 (이슈 부착도 cascade).
export async function deleteLabel(projectKey: string, id: number): Promise<void> {
  await client.delete<void>(`/projects/${projectKey}/labels/${id}`);
}

// 이슈 라벨 집합 통째 교체 — diff 만 백엔드가 처리.
export async function replaceIssueLabels(
  projectKey: string,
  number: number,
  labelIds: number[],
): Promise<LabelSummary[]> {
  const { data } = await client.put<LabelSummary[]>(
    `/projects/${projectKey}/issues/${number}/labels`,
    { labelIds },
  );
  return data;
}
