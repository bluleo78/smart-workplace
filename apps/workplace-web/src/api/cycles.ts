// 사이클 API 클라이언트 — 프로젝트 CRUD + 진행 집계 + 이슈 사이클 집합 교체.

import type { CycleProgress, CycleRequest, CycleResponse, CycleSummary } from '../types/cycle';
import { client } from './client';

// 프로젝트의 사이클 전체 목록 (멤버 권한).
export async function listCycles(projectKey: string): Promise<CycleResponse[]> {
  const { data } = await client.get<CycleResponse[]>(`/projects/${projectKey}/cycles`);
  return data;
}

// OWNER 전용 — 신규 사이클 생성.
export async function createCycle(
  projectKey: string,
  body: CycleRequest,
): Promise<CycleResponse> {
  const { data } = await client.post<CycleResponse>(`/projects/${projectKey}/cycles`, body);
  return data;
}

// OWNER 전용 — 사이클 수정.
export async function updateCycle(
  projectKey: string,
  id: number,
  body: CycleRequest,
): Promise<CycleResponse> {
  const { data } = await client.patch<CycleResponse>(`/projects/${projectKey}/cycles/${id}`, body);
  return data;
}

// OWNER 전용 — 사이클 삭제 (이슈 연결도 cascade).
export async function deleteCycle(projectKey: string, id: number): Promise<void> {
  await client.delete<void>(`/projects/${projectKey}/cycles/${id}`);
}

// 프로젝트 전 사이클 진행 집계.
export async function listCycleProgress(projectKey: string): Promise<CycleProgress[]> {
  const { data } = await client.get<CycleProgress[]>(`/projects/${projectKey}/cycles/progress`);
  return data;
}

// 이슈에 연결된 사이클 요약.
export async function listIssueCycles(
  projectKey: string,
  number: number,
): Promise<CycleSummary[]> {
  const { data } = await client.get<CycleSummary[]>(
    `/projects/${projectKey}/issues/${number}/cycles`,
  );
  return data;
}

// 이슈 사이클 집합 통째 교체.
export async function replaceIssueCycles(
  projectKey: string,
  number: number,
  cycleIds: number[],
): Promise<CycleSummary[]> {
  const { data } = await client.put<CycleSummary[]>(
    `/projects/${projectKey}/issues/${number}/cycles`,
    { cycleIds },
  );
  return data;
}
