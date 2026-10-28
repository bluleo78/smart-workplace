// AGENT 유저 + API 키 ADMIN 엔드포인트 — 권한 `user:manage` 필요.
// baseURL `/api/v1` 가 client 에 포함되어 있어 경로는 상대로 작성.

import type { AgentResponse, AgentRuntime } from '../types/agent';
import type { AgentApiKey, AgentApiKeyIssueResponse } from '../types/agentKey';
import type { UserResponse } from '../types/auth';
import type {
  ProviderCredentialMeta,
  ProviderCredentialRegisterRequest,
} from '../types/providerCredential';
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

// AGENT 이름/식별자/설명(역할)/지시 변경 — username·name·description(WP-455)·instructions(WP-1077).
// description·instructions 는 빈 문자열이면 지우고 빼면 그대로 둔다. 개인 비서는 백엔드에서 403 거부.
export async function renameAgent(
  userId: number,
  body: { username: string; name: string; description: string; instructions?: string },
): Promise<void> {
  await client.put<void>(`/admin/agents/${userId}`, body);
}

// 실행 방식 변경 — 공통·개인 비서는 서버가 409(한국어 message)로 거부한다.
export async function setAgentRuntime(userId: number, runtime: AgentRuntime): Promise<void> {
  await client.put<void>(`/admin/agents/${userId}/runtime`, { runtime });
}

// AGENT 삭제 결과 — DELETED=완전히 지움(키도 함께), DEACTIVATED=남은 기록이 있어 삭제 대신 사용 중지(WP-705).
export type AgentRemovalResult = 'DELETED' | 'DEACTIVATED';

// AGENT 유저 삭제 — 기록이 남은 AI 는 서버가 삭제 대신 사용을 중지하고 그 결과를 돌려준다(WP-705).
export async function deleteAgent(userId: number): Promise<AgentRemovalResult> {
  const { data } = await client.delete<{ result: AgentRemovalResult }>(`/admin/agents/${userId}`);
  return data.result;
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

// AGENT 의 active 프로바이더 자격증명 메타 조회 — 평문 미포함. 미등록 시 404.
export async function getAgentProviderCredentialMeta(
  userId: number,
): Promise<ProviderCredentialMeta> {
  const { data } = await client.get<ProviderCredentialMeta>(
    `/admin/agents/${userId}/provider-credential`,
  );
  return data;
}

// 자격증명 등록(또는 재발급 — 기존 active 자동 revoke). 응답에 평문 미포함.
export async function registerAgentProviderCredential(
  userId: number,
  body: ProviderCredentialRegisterRequest,
): Promise<ProviderCredentialMeta> {
  const { data } = await client.post<ProviderCredentialMeta>(
    `/admin/agents/${userId}/provider-credential`,
    body,
  );
  return data;
}

// 자격증명 회수 — idempotent. 회수 후 AGENT 는 LLM 호출 불가 상태.
export async function revokeAgentProviderCredential(userId: number): Promise<void> {
  await client.delete<void>(`/admin/agents/${userId}/provider-credential`);
}
