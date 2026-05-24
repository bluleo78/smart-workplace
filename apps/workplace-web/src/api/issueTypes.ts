// 이슈 유형 (Issue Type) API 클라이언트.
// 정의 CRUD + 이슈별 유형 변경 (PATCH /issues/{number}/type).

import type { IssueDetailResponse } from '../types/issue';
import type { IssueTypeResponse } from '../types/issueType';
import { client } from './client';

export interface IssueTypeMutationBody {
  name: string;
  colorToken: string;
  icon: string;
}

export async function listIssueTypes(projectKey: string): Promise<IssueTypeResponse[]> {
  const { data } = await client.get<IssueTypeResponse[]>(`/projects/${projectKey}/types`);
  return data;
}

export async function createIssueType(
  projectKey: string,
  body: IssueTypeMutationBody,
): Promise<IssueTypeResponse> {
  const { data } = await client.post<IssueTypeResponse>(
    `/projects/${projectKey}/types`,
    body,
  );
  return data;
}

export async function updateIssueType(
  projectKey: string,
  id: number,
  body: IssueTypeMutationBody,
): Promise<IssueTypeResponse> {
  const { data } = await client.patch<IssueTypeResponse>(
    `/projects/${projectKey}/types/${id}`,
    body,
  );
  return data;
}

export async function deleteIssueType(projectKey: string, id: number): Promise<void> {
  await client.delete<void>(`/projects/${projectKey}/types/${id}`);
}

// 이슈 단건의 유형 변경 — PATCH 응답은 IssueDetailResponse.
export async function updateIssueTypeOf(
  projectKey: string,
  number: number,
  typeId: number,
): Promise<IssueDetailResponse> {
  const { data } = await client.patch<IssueDetailResponse>(
    `/projects/${projectKey}/issues/${number}/type`,
    { typeId },
  );
  return data;
}
