// 구성요소 API 클라이언트(WP-933) — 프로젝트 구성요소 관리 + 이슈 구성요소 집합 교체.

import type {
  ComponentResponse,
  ComponentSummary,
  CreateComponentRequest,
  UpdateComponentRequest,
} from '../types/component';
import { client } from './client';

// 프로젝트 구성요소 전체(보관 포함, 목록 순서) — 프로젝트를 읽을 수 있으면 누구나.
export async function listComponents(projectKey: string): Promise<ComponentResponse[]> {
  const { data } = await client.get<ComponentResponse[]>(`/projects/${projectKey}/components`);
  return data;
}

// 추가 — OWNER·ADMIN.
export async function createComponent(projectKey: string, body: CreateComponentRequest): Promise<ComponentResponse> {
  const { data } = await client.post<ComponentResponse>(`/projects/${projectKey}/components`, body);
  return data;
}

// 부분 수정(이름·설명·담당자·보관/복원) — OWNER·ADMIN.
export async function updateComponent(
  projectKey: string,
  id: number,
  body: UpdateComponentRequest,
): Promise<ComponentResponse> {
  const { data } = await client.patch<ComponentResponse>(`/projects/${projectKey}/components/${id}`, body);
  return data;
}

// 삭제 — OWNER·ADMIN. 붙어 있던 이슈에서 빠지고 이슈마다 제거 기록이 남는다.
export async function deleteComponent(projectKey: string, id: number): Promise<void> {
  await client.delete<void>(`/projects/${projectKey}/components/${id}`);
}

// 이슈 구성요소 집합 통째 교체 — 이미 붙어 있던 보관 구성요소는 남길 수 있고, 보관된 것을 새로 붙이면 400.
export async function replaceIssueComponents(
  projectKey: string,
  number: number,
  componentIds: number[],
): Promise<ComponentSummary[]> {
  const { data } = await client.put<ComponentSummary[]>(`/projects/${projectKey}/issues/${number}/components`, {
    componentIds,
  });
  return data;
}
