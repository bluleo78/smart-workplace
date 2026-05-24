// AGENT 유저 + API 키 ADMIN 엔드포인트 — 권한 `user:manage` 필요.
// baseURL `/api/v1` 가 client 에 포함되어 있어 경로는 상대로 작성.

import type { UserResponse } from '../types/auth';
import type { AgentApiKey, AgentApiKeyIssueResponse } from '../types/agentKey';

import { client } from './client';

// AGENT 유저 목록 조회 — kind=AGENT 만 반환됨.
export async function listAgents(): Promise<UserResponse[]> {
  const { data } = await client.get<UserResponse[]>('/admin/agents');
  return data;
}

// 신규 AGENT 유저 생성. password 없이 username/name/email 만 받음.
export async function createAgent(body: {
  username: string;
  name: string;
  email: string;
}): Promise<UserResponse> {
  const { data } = await client.post<UserResponse>('/admin/agents', body);
  return data;
}

// AGENT 유저 삭제 — cascade 로 키도 함께 제거.
export async function deleteAgent(userId: number): Promise<void> {
  await client.delete<void>(`/admin/agents/${userId}`);
}

// 특정 AGENT 의 API 키 목록 (활성/회수 모두 포함).
export async function listAgentKeys(userId: number): Promise<AgentApiKey[]> {
  const { data } = await client.get<AgentApiKey[]>(`/admin/agents/${userId}/keys`);
  return data;
}

// 키 발급 — 응답에 plaintextKey 가 1회만 포함된다.
export async function issueAgentKey(
  userId: number,
  body: { label?: string | null },
): Promise<AgentApiKeyIssueResponse> {
  const { data } = await client.post<AgentApiKeyIssueResponse>(
    `/admin/agents/${userId}/keys`,
    body,
  );
  return data;
}

// 키 회수 — revoked_at 마킹. 인증 hot path 에서 즉시 차단.
export async function revokeAgentKey(userId: number, keyId: number): Promise<void> {
  await client.delete<void>(`/admin/agents/${userId}/keys/${keyId}`);
}
