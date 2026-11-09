// AI 계정 목록(WP-1451) — 목록·AI 가 묶인 계정 조회와 등록·수정·폐기·묶기 mutation.
// 목록은 60초마다 다시 받는다 — 「N분 전」·「N시간 M분 뒤 초기화」가 낡지 않고, 서버가 주기적으로 잰 사용률을 따라가게.
// 성공·실패 토스트는 호출 측(창)에서 한다. 여기는 캐시 무효화만.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  bindAgentAccount,
  createAgentAccount,
  deleteAgentAccount,
  getAgentBoundAccount,
  listAgentAccounts,
  updateAgentAccount,
} from '../../api/agentAccounts';
import { isNotFoundError } from '../../lib/api-error';
import type {
  AgentAccountCreateRequest,
  AgentAccountResponse,
  AgentAccountUpdateRequest,
} from '../../types/agentAccount';

/** 계정 목록을 다시 받는 간격(ms). */
const AGENT_ACCOUNTS_REFETCH_MS = 60_000;

export const agentAccountKeys = {
  all: ['agentAccounts'] as const,
  list: () => ['agentAccounts', 'list'] as const,
  /** 이 AI 가 묶인 계정 — 같은 접두어라 all 무효화에 함께 걸린다(계정 수정·폐기가 묶인 계정 표시도 바꾼다). */
  forAgent: (userId: number | null) => ['agentAccounts', 'agent', userId] as const,
};

/** 계정 목록 — 60초마다 다시 받는다. */
export function useAgentAccounts() {
  return useQuery({
    queryKey: agentAccountKeys.list(),
    queryFn: listAgentAccounts,
    refetchInterval: AGENT_ACCOUNTS_REFETCH_MS,
  });
}

/** 이 AI 가 묶인 계정 — 404 는 안 묶인 정상 상태라 null. */
export function useAgentBoundAccount(userId: number | null) {
  return useQuery<AgentAccountResponse | null>({
    queryKey: agentAccountKeys.forAgent(userId),
    enabled: userId != null,
    queryFn: async () => {
      try {
        return await getAgentBoundAccount(userId as number);
      } catch (e: unknown) {
        if (isNotFoundError(e)) return null;
        throw e;
      }
    },
  });
}

/** 계정 등록 — 목록을 다시 받는다. */
export function useCreateAgentAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: AgentAccountCreateRequest) => createAgentAccount(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentAccountKeys.list() }),
  });
}

/** 계정 수정 — 라벨·원문이 바뀌면 목록과 AI 별 묶인 계정 표시가 함께 낡으니 계정 키 전부를 무효화한다. */
export function useUpdateAgentAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: AgentAccountUpdateRequest }) => updateAgentAccount(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentAccountKeys.all }),
  });
}

/** 계정 폐기 — 쓰는 AI 가 있으면 서버가 409 로 거절한다(문구는 호출 측). */
export function useDeleteAgentAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteAgentAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentAccountKeys.all }),
  });
}

/** 이 AI 를 계정에 묶는다 — 목록(쓰는 AI 칸)은 다시 받고, 이 AI 의 묶인 계정은 응답(묶인 계정)으로 바로 채운다(한 번 더 받지 않게). */
export function useBindAgentAccount(userId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) => bindAgentAccount(userId as number, accountId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: agentAccountKeys.list() });
      qc.setQueryData(agentAccountKeys.forAgent(userId), data);
    },
  });
}
