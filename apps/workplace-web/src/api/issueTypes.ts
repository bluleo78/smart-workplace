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
// parentNumber 를 주면 같은 요청에서 부모도 바꾼다 — SUBTASK 로 바꿀 때는 부모가 필수다(WP-745).
// opts(WP-2097): parentKey 는 「상위의 에픽 아래로 이동」(다른 프로젝트 에픽도 같은 경로), relateToReleasedParent 는
// 옛 상위와의 관련 관계 유지 — 둘 다 「상위 연결 변경」 확인 창의 선택이다. 안 주면 두 필드 모두 본문에서 빠진다.
export async function updateIssueTypeOf(
  projectKey: string,
  number: number,
  typeId: number,
  parentNumber?: number,
  opts?: { parentKey?: string; relateToReleasedParent?: boolean },
): Promise<IssueDetailResponse> {
  const body: { typeId: number; parentNumber?: number; parentKey?: string; relateToReleasedParent?: boolean } = {
    typeId,
  };
  if (parentNumber !== undefined) body.parentNumber = parentNumber;
  if (opts?.parentKey !== undefined) body.parentKey = opts.parentKey;
  if (opts?.relateToReleasedParent !== undefined) body.relateToReleasedParent = opts.relateToReleasedParent;
  const { data } = await client.patch<IssueDetailResponse>(`/projects/${projectKey}/issues/${number}/type`, body);
  return data;
}
