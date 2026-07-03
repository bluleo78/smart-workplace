// 프로바이더 모델 목록/프로브 엔드포인트 — Task10 백엔드(AssistantModelsController) 대응.
// 등록 전(probe, 임의 baseURL+apiKey) 과 등록 후(저장된 자격증명 기준 조회) 양쪽 제공.
// baseURL `/api/v1` 가 client 에 포함되어 있어 경로는 상대로 작성.

import type { CredentialProvider, ModelOption, ProviderConfig } from '../types/providerCredential';
import { client } from './client';

// 관리자 — 임의 baseURL+apiKey 로 등록 전 모델 프로브(AGENT 공통, userId 불필요).
export async function probeAgentModels(body: {
  providerConfig: ProviderConfig;
}): Promise<{ models: ModelOption[] }> {
  const { data } = await client.post<{ models: ModelOption[] }>(
    '/admin/agents/models/probe',
    body,
  );
  return data;
}

// 본인(개인 비서) — 임의 baseURL+apiKey 로 등록 전 모델 프로브.
export async function probeMyAssistantModels(body: {
  providerConfig: ProviderConfig;
}): Promise<{ models: ModelOption[] }> {
  const { data } = await client.post<{ models: ModelOption[] }>(
    '/users/me/assistant/models/probe',
    body,
  );
  return data;
}

// 관리자 — AGENT 의 저장된 자격증명 기준 모델 목록. anthropic 은 정적 목록, opencode 는 실시간 프로브.
export async function getAgentModels(
  userId: number,
): Promise<{ provider: CredentialProvider; models: ModelOption[] }> {
  const { data } = await client.get<{ provider: CredentialProvider; models: ModelOption[] }>(
    `/admin/agents/${userId}/models`,
  );
  return data;
}

// 본인 — 개인 비서의 저장된 자격증명 기준 모델 목록. 개인 비서 미설정이면 409.
export async function getMyAssistantModels(): Promise<{
  provider: CredentialProvider;
  models: ModelOption[];
}> {
  const { data } = await client.get<{ provider: CredentialProvider; models: ModelOption[] }>(
    '/users/me/assistant/models',
  );
  return data;
}
