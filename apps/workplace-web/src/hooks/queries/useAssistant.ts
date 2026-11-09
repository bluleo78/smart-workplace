// 비서(Assistant) TanStack 훅 — 개인(본인) + 공용(admin) 조회·변경.
// 쓰기 mutation 은 성공 시 해당 캐시만 무효화. 토스트/에러는 호출 측에서 처리.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getAgentAccount } from '../../api/agents';
import {
  clearWorkspaceAssistant,
  disableMyAssistant,
  getMyAssistant,
  getWorkspaceAssistant,
  registerMyAssistantCredential,
  setWorkspaceAssistant,
  updateMyAssistantName,
  updateMyAssistantSettings,
  updateWorkspaceAssistantSettings,
} from '../../api/assistant';
import { getAgentModels, getMyAssistantModels } from '../../api/models';
import type { AgentAccount } from '../../types/agentAccount';
import type { UpdateAssistantSettings } from '../../types/assistant';
import type { ProviderCredentialRegisterRequest } from '../../types/providerCredential';

export const assistantKeys = {
  me: ['assistant', 'me'] as const,
  workspace: ['assistant', 'workspace'] as const,
};

// 프로바이더 모델 목록 쿼리키 — 관리자(AGENT별)/본인(개인 비서) 분리.
export const providerModelsKeys = {
  forAgent: (userId: number | null, accountId?: number | null) => ['providerModels', 'agent', userId, accountId ?? null] as const,
  me: ['providerModels', 'me'] as const,
};

// AI 가 묶인 계정(식별 — 평문 없음, WP-1448/1458). 모델 목록 키가 계정을 따르므로 묶음이 바뀌면 목록도 새 키로 다시 받는다.
export const agentAccountKeys = {
  forUser: (userId: number | null) => ['agentAccount', userId] as const,
};

// 개인 비서 상태 조회.
export function useMyAssistant() {
  return useQuery({ queryKey: assistantKeys.me, queryFn: getMyAssistant });
}

// 개인 비서 자격증명 등록(또는 교체) — anthropic(token)/opencode(providerConfig+model) 공통.
// WP-1322: 모델 목록도 함께 무효화한다 — 연결(provider)이 바뀌면 목록이 통째로 달라지는데, 상태만 갱신하면 예전 연결(예: OpenAI 호환)의
// 모델이 드롭다운에 그대로 남았다.
export function useRegisterMyAssistantCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProviderCredentialRegisterRequest) =>
      registerMyAssistantCredential(body),
    onSuccess: () => {
      // 모델 목록 재조회는 기다리지 않는다 — OpenAI 호환은 첫 조회가 수 초 걸려(생각의 깊이 단계 조회) 등록 완료 토스트가 늦어진다.
      void qc.invalidateQueries({ queryKey: providerModelsKeys.me });
      return qc.invalidateQueries({ queryKey: assistantKeys.me });
    },
  });
}

// 개인 비서 설정 변경.
export function useUpdateMyAssistantSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateAssistantSettings) => updateMyAssistantSettings(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: assistantKeys.me }),
  });
}

// 개인 비서 표시 이름 변경.
export function useUpdateMyAssistantName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => updateMyAssistantName(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: assistantKeys.me }),
  });
}

// 개인 비서 비활성화. WP-1322: 끊긴 연결의 모델 목록이 다음 연결에 남지 않게 모델 목록 캐시도 지운다(무효화가 아니라 제거 —
// 해제 뒤엔 조회가 비활성(enabled=false)이라 무효화만으로는 옛 데이터가 남아 있다가 새 연결 직후 잠깐 보인다).
export function useDisableMyAssistant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => disableMyAssistant(),
    onSuccess: () => {
      qc.removeQueries({ queryKey: providerModelsKeys.me });
      return qc.invalidateQueries({ queryKey: assistantKeys.me });
    },
  });
}

// 공통 비서 상태 조회.
export function useWorkspaceAssistant() {
  return useQuery({
    queryKey: assistantKeys.workspace,
    queryFn: getWorkspaceAssistant,
  });
}

// 공통 비서 AGENT 유저 지정.
export function useSetWorkspaceAssistant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentUserId: number) => setWorkspaceAssistant(agentUserId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: assistantKeys.workspace });
      // 에이전트 목록의 '유형' 컬럼(공통/일반)도 갱신.
      qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

// 공통 비서 설정 변경.
export function useUpdateWorkspaceAssistantSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateAssistantSettings) =>
      updateWorkspaceAssistantSettings(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: assistantKeys.workspace }),
  });
}

// 공통 비서 지정 해제.
export function useClearWorkspaceAssistant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => clearWorkspaceAssistant(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: assistantKeys.workspace });
      // 에이전트 목록의 '유형' 컬럼(공통/일반)도 갱신.
      qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

// 관리자 — AGENT 가 묶인 계정(meta, WP-1448). 묶이지 않았으면 404 → null(옛 연결 경로 목록은 계정 키 없이 조회된다).
export function useAgentAccount(userId: number | null) {
  return useQuery<AgentAccount | null>({
    queryKey: agentAccountKeys.forUser(userId),
    enabled: userId != null,
    queryFn: async () => {
      try {
        return await getAgentAccount(userId as number);
      } catch (e: unknown) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 404) return null;
        throw e;
      }
    },
  });
}

// 관리자 — AGENT 의 모델 목록(묶인 계정/저장된 자격증명 기준). WP-1405: 5분 동안 새로 받지 않는다 — 상세 화면을 열 때마다 ai-agent →
// Anthropic 조회를 반복하지 않게. 계정이 바뀌면 키(accountId)가 달라져 새로 받고, 연결·다시 연결·끊기의 무효화도 함께 걸린다.
export function useAgentModels(userId: number | null, accountId?: number | null) {
  return useQuery({
    queryKey: providerModelsKeys.forAgent(userId, accountId ?? null),
    enabled: userId != null,
    staleTime: 5 * 60_000,
    queryFn: () => getAgentModels(userId as number),
  });
}

// 본인 — 개인 비서의 저장된 자격증명 기준 모델 목록. 미설정 상태(409)면 호출측이 enabled=false 로 비활성화.
export function useMyAssistantModels(enabled = true) {
  return useQuery({
    queryKey: providerModelsKeys.me,
    enabled,
    queryFn: () => getMyAssistantModels(),
  });
}
