// 버전 API 클라이언트(WP-888) — 프로젝트 버전 관리·출시·삭제·붙은 이슈 수.

import type {
  CreateVersionRequest,
  IssueVersionsResponse,
  ReleaseVersionRequest,
  ReplaceIssueVersionsRequest,
  UpdateVersionRequest,
  VersionIssueCount,
  VersionResponse,
} from '../types/version';
import { client } from './client';

// 프로젝트 버전 전체(보관 포함, 목록 순서) — 프로젝트를 읽을 수 있으면 누구나.
export async function listVersions(projectKey: string): Promise<VersionResponse[]> {
  const { data } = await client.get<VersionResponse[]>(`/projects/${projectKey}/versions`);
  return data;
}

// 한 건 — 다른 프로젝트의 id 는 404.
export async function getVersion(projectKey: string, id: number): Promise<VersionResponse> {
  const { data } = await client.get<VersionResponse>(`/projects/${projectKey}/versions/${id}`);
  return data;
}

// 추가 — OWNER·ADMIN.
export async function createVersion(projectKey: string, body: CreateVersionRequest): Promise<VersionResponse> {
  const { data } = await client.post<VersionResponse>(`/projects/${projectKey}/versions`, body);
  return data;
}

// 부분 수정(이름·설명·날짜·보관/복원) — OWNER·ADMIN.
export async function updateVersion(
  projectKey: string,
  id: number,
  body: UpdateVersionRequest,
): Promise<VersionResponse> {
  const { data } = await client.patch<VersionResponse>(`/projects/${projectKey}/versions/${id}`, body);
  return data;
}

// 출시 — 끝나지 않은 이슈를 다음 버전으로 옮길 수 있다.
export async function releaseVersion(
  projectKey: string,
  id: number,
  body: ReleaseVersionRequest,
): Promise<VersionResponse> {
  const { data } = await client.post<VersionResponse>(`/projects/${projectKey}/versions/${id}/release`, body);
  return data;
}

// 출시 취소 — 출시 시각만 지운다(옮긴 이슈는 되돌리지 않는다).
export async function unreleaseVersion(projectKey: string, id: number): Promise<VersionResponse> {
  const { data } = await client.post<VersionResponse>(`/projects/${projectKey}/versions/${id}/unrelease`);
  return data;
}

// 붙은 이슈 수 — 삭제 확인창·출시 대화상자 안내.
export async function getVersionIssueCount(projectKey: string, id: number): Promise<VersionIssueCount> {
  const { data } = await client.get<VersionIssueCount>(`/projects/${projectKey}/versions/${id}/issue-count`);
  return data;
}

// 삭제 — 보관한 버전만. moveTo 가 있으면 붙은 이슈를 같은 종류로 그 버전에 옮기고, 없으면 떼기만 한다.
export async function deleteVersion(projectKey: string, id: number, moveTo?: number | null): Promise<void> {
  await client.delete<void>(`/projects/${projectKey}/versions/${id}`, {
    params: moveTo != null ? { moveTo } : undefined,
  });
}

// 이슈의 수정 버전·영향 버전 집합 교체 — 보낸 종류만 바뀐다. 이미 붙은 보관 버전은 남길 수 있고, 보관된 것을 새로 붙이면 400(VERSION_ARCHIVED).
export async function replaceIssueVersions(
  projectKey: string,
  number: number,
  body: ReplaceIssueVersionsRequest,
): Promise<IssueVersionsResponse> {
  const { data } = await client.put<IssueVersionsResponse>(`/projects/${projectKey}/issues/${number}/versions`, body);
  return data;
}
