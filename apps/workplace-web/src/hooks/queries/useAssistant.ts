// 비서(Assistant) TanStack 훅 — 개인(본인) + 공용(admin) 조회·변경.
// 쓰기 mutation 은 성공 시 해당 캐시만 무효화. 토스트/에러는 호출 측에서 처리.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
import type { UpdateAssistantSettings } from '../../types/assistant';
import type { ProviderCredentialRegisterRequest } from '../../types/providerCredential';

export const assistantKeys = {
  me: ['assistant', 'me'] as const,
  workspace: ['assistant', 'workspace'] as const,
};

// 프로바이더 모델 목록 쿼리키 — 관리자(AGENT별)/본인(개인 비서) 분리.
export const providerModelsKeys = {
  forAgent: (userId: number | null) => ['providerModels', 'agent', userId] as const,
  me: ['providerModels', 'me'] as const,
};

// 개인 비서 상태 조회.
export function useMyAssistant() {
  return useQuery({ queryKey: assistantKeys.me, queryFn: getMyAssistant });
}

// 개인 비서 자격증명 등록(또는 교체) — anthropic(token)/opencode(providerConfig+model) 공통.
export function useRegisterMyAssistantCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProviderCredentialRegisterRequest) =>
      registerMyAssistantCredential(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: assistantKeys.me }),
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

// 개인 비서 비활성화.
export function useDisableMyAssistant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => disableMyAssistant(),
    onSuccess: () => qc.invalidateQueries({ queryKey: assistantKeys.me }),
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

// 관리자 — AGENT 의 저장된 자격증명 기준 모델 목록. userId 미지정(null) 이면 비활성화.
export function useAgentModels(userId: number | null) {
  return useQuery({
    queryKey: providerModelsKeys.forAgent(userId),
    enabled: userId != null,
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
