// AGENT 프로바이더 자격증명 — 메타 조회 + 등록/회수 mutation.
// 평문 자격증명(token/providerConfig)은 입력 시점에만 다루고 응답에는 절대 포함되지 않는다.
// 미등록 상태 (404) 는 정상적인 비등록으로 간주해 null 반환 — 등록 UI 분기에 사용.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getAgentProviderCredentialMeta,
  registerAgentProviderCredential,
  revokeAgentProviderCredential,
} from '../../api/agents';
import type {
  ProviderCredentialMeta,
  ProviderCredentialRegisterRequest,
} from '../../types/providerCredential';
import { assistantKeys, providerModelsKeys } from './useAssistant';

export const agentProviderCredentialKeys = {
  forUser: (userId: number | null) => ['agentProviderCredential', userId] as const,
};

// AGENT 의 프로바이더 자격증명 메타 — 404 는 미등록 상태로 간주, null 반환.
export function useAgentProviderCredentialMeta(userId: number | null) {
  return useQuery<ProviderCredentialMeta | null>({
    queryKey: agentProviderCredentialKeys.forUser(userId),
    enabled: userId != null,
    queryFn: async () => {
      try {
        return await getAgentProviderCredentialMeta(userId as number);
      } catch (e: unknown) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 404) return null;
        throw e;
      }
    },
  });
}

/**
 * 연결이 바뀐 뒤 함께 낡는 캐시 — 연결 메타, 이 AGENT 의 모델 목록(WP-1322: provider 가 바뀌면 목록이 통째로 달라지는데 남아 있었다),
 * 공통 비서 상태(등록이 모델을 바꾸고 hasActiveToken 이 바뀐다).
 */
function invalidateConnection(qc: ReturnType<typeof useQueryClient>, userId: number | null) {
  qc.invalidateQueries({ queryKey: agentProviderCredentialKeys.forUser(userId) });
  qc.invalidateQueries({ queryKey: providerModelsKeys.forAgent(userId) });
  qc.invalidateQueries({ queryKey: assistantKeys.workspace });
}

// 자격증명 등록 — 성공/실패 토스트는 호출 측 (Dialog) 에서 처리. 여기는 캐시 무효화만.
export function useRegisterAgentProviderCredential(userId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ProviderCredentialRegisterRequest) =>
      registerAgentProviderCredential(userId as number, req),
    onSuccess: () => invalidateConnection(qc, userId),
  });
}

// 자격증명 회수 — idempotent. 회수 후 캐시 무효화하여 등록 화면으로 전환.
export function useRevokeAgentProviderCredential(userId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => revokeAgentProviderCredential(userId as number),
    onSuccess: () => invalidateConnection(qc, userId),
  });
}
