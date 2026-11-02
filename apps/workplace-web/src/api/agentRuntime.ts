// AI 실행(WP-1245) ADMIN 엔드포인트 — 실행 템플릿·AI 실행 설정·실행 위치. 권한 `user:manage`.

import type {
  AgentLocation,
  AgentLocationTokenResponse,
  AgentRepoCredential,
  AgentRuntimeProject,
  AgentRuntimeSetting,
  AgentRuntimeSummary,
  AgentTemplate,
  PutAgentRuntimeSettingRequest,
  RepoKind,
} from '../types/agentRuntime';
import { client } from './client';

// 실행 템플릿 목록 — 「기본」(SERVER)과 작업 공간 템플릿(WORKSPACE).
export async function listAgentTemplates(): Promise<AgentTemplate[]> {
  const { data } = await client.get<AgentTemplate[]>('/admin/agent-templates');
  return data;
}

// AI 한 명의 실행 설정 — 없으면 404(=「기본」 또는 외부).
export async function getAgentRuntimeSetting(userId: number): Promise<AgentRuntimeSetting | null> {
  const { data, status } = await client.get<AgentRuntimeSetting>(`/admin/agents/${userId}/runtime-setting`, {
    validateStatus: (s) => s === 200 || s === 404,
  });
  return status === 404 ? null : data;
}

// 실행 설정 저장 — 처음 저장하면 실행 방식이 작업 공간으로 바뀐다(서버가 함께 처리). 켜져 있으면 applyMode 대로 반영.
export async function putAgentRuntimeSetting(
  userId: number,
  body: PutAgentRuntimeSettingRequest,
): Promise<AgentRuntimeSetting> {
  const { data } = await client.put<AgentRuntimeSetting>(`/admin/agents/${userId}/runtime-setting`, body);
  return data;
}

// 실행 설정 삭제 — 꺼져 있을 때만(켜져 있으면 409). 실행 방식은 호출한 쪽이 이어서 바꾼다.
export async function deleteAgentRuntimeSetting(userId: number): Promise<void> {
  await client.delete<void>(`/admin/agents/${userId}/runtime-setting`);
}

export type AgentRuntimeAction = 'start' | 'stop' | 'restart';

// 켜기·끄기·다시 시작.
export async function runAgentRuntimeAction(
  userId: number,
  action: AgentRuntimeAction,
): Promise<AgentRuntimeSetting> {
  const { data } = await client.post<AgentRuntimeSetting>(`/admin/agents/${userId}/runtime-setting/${action}`);
  return data;
}

// 목록 「실행」 열 — 실행 설정이 있는 AI 들의 요약(한 번에).
export async function listAgentRuntimeSummaries(): Promise<AgentRuntimeSummary[]> {
  const { data } = await client.get<AgentRuntimeSummary[]>('/admin/agent-runtime-summaries');
  return data;
}

// 이 AI 가 맡는 프로젝트(멤버 + 저장소 연결) — 읽기 전용.
export async function listAgentRuntimeProjects(userId: number): Promise<AgentRuntimeProject[]> {
  const { data } = await client.get<AgentRuntimeProject[]>(`/admin/agents/${userId}/runtime-setting/projects`);
  return data;
}

// 실행 위치 목록.
export async function listAgentLocations(): Promise<AgentLocation[]> {
  const { data } = await client.get<AgentLocation[]>('/admin/agent-locations');
  return data;
}

// 위치 추가 — runner 토큰 원문은 응답에 한 번만 온다.
export async function createAgentLocation(body: {
  name: string;
  description: string | null;
  capacity: number;
}): Promise<AgentLocationTokenResponse> {
  const { data } = await client.post<AgentLocationTokenResponse>('/admin/agent-locations', body);
  return data;
}

// 위치 이름·설명·자리 수 변경.
export async function updateAgentLocation(
  id: number,
  body: { name: string; description: string | null; capacity: number },
): Promise<AgentLocation> {
  const { data } = await client.put<AgentLocation>(`/admin/agent-locations/${id}`, body);
  return data;
}

// 기본 위치로 지정.
export async function setDefaultAgentLocation(id: number): Promise<void> {
  await client.post<void>(`/admin/agent-locations/${id}/default`);
}

// runner 토큰 재발급 — 옛 토큰은 바로 끊긴다.
export async function rotateAgentLocationToken(id: number): Promise<AgentLocationTokenResponse> {
  const { data } = await client.post<AgentLocationTokenResponse>(`/admin/agent-locations/${id}/token`);
  return data;
}

// 위치 삭제 — 쓰는 AI 가 있으면 409.
export async function deleteAgentLocation(id: number): Promise<void> {
  await client.delete<void>(`/admin/agent-locations/${id}`);
}

// 이 AI 의 저장소 토큰 목록(활성만, 호스트 순) — 토큰 원문은 오지 않는다.
export async function listRepoCredentials(userId: number): Promise<AgentRepoCredential[]> {
  const { data } = await client.get<AgentRepoCredential[]>(`/admin/agents/${userId}/repo-credentials`);
  return data;
}

// 저장소 토큰 등록·교체 — 같은 호스트에 이미 있으면 서버가 이전 것을 폐기하고 새로 저장한다.
export async function registerRepoCredential(
  userId: number,
  body: { kind: RepoKind; host: string; token: string },
): Promise<AgentRepoCredential> {
  const { data } = await client.post<AgentRepoCredential>(`/admin/agents/${userId}/repo-credentials`, body);
  return data;
}

// 저장소 토큰 연결 끊기.
export async function revokeRepoCredential(userId: number, id: number): Promise<void> {
  await client.delete<void>(`/admin/agents/${userId}/repo-credentials/${id}`);
}
