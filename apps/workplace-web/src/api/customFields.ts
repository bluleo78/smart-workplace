// 프로젝트 커스텀 필드 API 클라이언트 — 정의 CRUD + 이슈별 값 PUT (Phase 4c).
// 백엔드 라우트: /projects/{key}/fields, /projects/{key}/issues/{number}/fields.

import type { IssueFieldDef } from '../types/customField';
import type { IssueDetailResponse } from '../types/issue';
import { client } from './client';

// 프로젝트의 커스텀 필드 정의 목록 (멤버 권한).
export async function listCustomFields(projectKey: string): Promise<IssueFieldDef[]> {
  const { data } = await client.get<IssueFieldDef[]>(`/projects/${projectKey}/fields`);
  return data;
}

// OWNER 전용 — 신규 필드 정의 추가.
export async function createCustomField(
  projectKey: string,
  body: { name: string; type: string; options?: string[] | null },
): Promise<IssueFieldDef> {
  const { data } = await client.post<IssueFieldDef>(`/projects/${projectKey}/fields`, body);
  return data;
}

// OWNER 전용 — name/options 수정 (type 은 immutable, 백엔드가 400 반환).
export async function updateCustomField(
  projectKey: string,
  id: number,
  body: { name: string; type: string; options?: string[] | null },
): Promise<IssueFieldDef> {
  const { data } = await client.patch<IssueFieldDef>(`/projects/${projectKey}/fields/${id}`, body);
  return data;
}

// OWNER 전용 — 필드 삭제. 이슈의 해당 필드 값들도 cascade 로 함께 삭제됨.
export async function deleteCustomField(projectKey: string, id: number): Promise<void> {
  await client.delete<void>(`/projects/${projectKey}/fields/${id}`);
}

// 이슈 커스텀 필드 값 일괄 PUT — 백엔드는 incoming 만 처리(미전송 defId 는 유지).
// value 가 null 인 항목은 row 삭제.
export async function updateIssueFieldValues(
  projectKey: string,
  number: number,
  values: { defId: number; value: unknown }[],
): Promise<IssueDetailResponse> {
  const { data } = await client.put<IssueDetailResponse>(
    `/projects/${projectKey}/issues/${number}/fields`,
    { values },
  );
  return data;
}
