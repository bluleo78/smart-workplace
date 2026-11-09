// AI 계정 목록 ADMIN 엔드포인트(WP-1448) — 계정 등록·수정·폐기와 AI → 계정 묶기.
// baseURL `/api/v1` 가 client 에 포함되어 있어 경로는 상대로 작성. 응답에는 원문이 실리지 않는다.

import type {
  AgentAccountCreateRequest,
  AgentAccountResponse,
  AgentAccountUpdateRequest,
} from '../types/agentAccount';
import { client } from './client';

// 계정 목록 — 사용량(5시간·주간)과 쓰는 AI 가 함께 실린다.
export async function listAgentAccounts(): Promise<AgentAccountResponse[]> {
  const { data } = await client.get<AgentAccountResponse[]>('/admin/agent-accounts');
  return data;
}

// 계정 등록 — 같은 키가 이미 있으면 409.
export async function createAgentAccount(body: AgentAccountCreateRequest): Promise<AgentAccountResponse> {
  const { data } = await client.post<AgentAccountResponse>('/admin/agent-accounts', body);
  return data;
}

// 계정 수정 — 라벨만 또는 원문 교체.
export async function updateAgentAccount(id: number, body: AgentAccountUpdateRequest): Promise<AgentAccountResponse> {
  const { data } = await client.patch<AgentAccountResponse>(`/admin/agent-accounts/${id}`, body);
  return data;
}

// 계정 폐기 — 이 계정을 쓰는 AI 가 있으면 409.
export async function deleteAgentAccount(id: number): Promise<void> {
  await client.delete<void>(`/admin/agent-accounts/${id}`);
}

// 이 AI 가 묶인 계정 — 안 묶였으면 404(훅이 null 로 바꾼다).
export async function getAgentBoundAccount(userId: number): Promise<AgentAccountResponse> {
  const { data } = await client.get<AgentAccountResponse>(`/admin/agents/${userId}/agent-account`);
  return data;
}

// 이 AI 를 계정에 묶는다 — 작업 공간 실행 방식이 아니면 409, 종류가 안 맞으면 400.
export async function bindAgentAccount(userId: number, accountId: number): Promise<AgentAccountResponse> {
  const { data } = await client.put<AgentAccountResponse>(`/admin/agents/${userId}/agent-account`, { accountId });
  return data;
}
