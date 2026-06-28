// AGENT 유저 + API 키 ADMIN 엔드포인트 — 권한 `user:manage` 필요.
// baseURL `/api/v1` 가 client 에 포함되어 있어 경로는 상대로 작성.

import type { AgentResponse } from '../types/agent';
import type { AgentApiKey, AgentApiKeyIssueResponse } from '../types/agentKey';
import type {
  OAuthTokenMeta,
  OAuthTokenRegisterRequest,
} from '../types/agentOAuthToken';
import type { UserResponse } from '../types/auth';
import { client } from './client';

// AGENT 유저 목록 조회 — kind=AGENT 만 반환됨. 응답엔 유형(type)·소유자(ownerName) 포함.
// includePersonal=false(기본)면 개인 비서(자동 생성 AGENT)는 제외된다.
export async function listAgents(includePersonal = false): Promise<AgentResponse[]> {
  const { data } = await client.get<AgentResponse[]>('/admin/agents', {
    params: includePersonal ? { includePersonal: true } : undefined,
  });
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

// AGENT 이름/식별자 변경 — username·name. 개인 비서는 백엔드에서 403 거부.
export async function renameAgent(
  userId: number,
  body: { username: string; name: string },
): Promise<void> {
  await client.put<void>(`/admin/agents/${userId}`, body);
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

// AGENT 의 active OAuth 토큰 메타 조회 — 평문 미포함. 미등록 시 404.
export async function getAgentOAuthTokenMeta(
  userId: number,
): Promise<OAuthTokenMeta> {
  const { data } = await client.get<OAuthTokenMeta>(
    `/admin/agents/${userId}/oauth-token`,
  );
  return data;
}

// OAuth 토큰 등록 (또는 재발급 — 기존 active 자동 revoke). 응답에 평문 미포함.
export async function registerAgentOAuthToken(
  userId: number,
  body: OAuthTokenRegisterRequest,
): Promise<OAuthTokenMeta> {
  const { data } = await client.post<OAuthTokenMeta>(
    `/admin/agents/${userId}/oauth-token`,
    body,
  );
  return data;
}

// OAuth 토큰 회수 — idempotent. 회수 후 AGENT 는 LLM 호출 불가 상태.
export async function revokeAgentOAuthToken(userId: number): Promise<void> {
  await client.delete<void>(`/admin/agents/${userId}/oauth-token`);
}
