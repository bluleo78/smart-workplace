// AI 계정 목록(WP-1451) — 목록·AI 가 묶인 계정 조회와 등록·수정·폐기·묶기 mutation.
// 목록은 60초마다 다시 받는다 — 「N분 전」·「N시간 M분 뒤 초기화」가 낡지 않고, 서버가 주기적으로 잰 사용률을 따라가게.
// 성공·실패 토스트는 호출 측(창)에서 한다. 여기는 캐시 무효화만.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  bindAgentAccount,
  createAgentAccount,
  deleteAgentAccount,
  getAgentBoundAccount,
  getGeniaLogin,
  listAgentAccounts,
  startGeniaLogin,
  updateAgentAccount,
} from '../../api/agentAccounts';
import { isNotFoundError } from '../../lib/api-error';
import { GENIA_LOGIN_POLL_MS } from '../../lib/geniaLogin';
import type {
  AgentAccountCreateRequest,
  AgentAccountResponse,
  AgentAccountUpdateRequest,
  GeniaLoginResponse,
  GeniaLoginStartRequest,
} from '../../types/agentAccount';
import { agentRuntimeKeys } from './agentRuntimeKeys';
import { providerModelsKeys } from './useAssistant';

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

/**
 * 계정 수정 — 라벨·원문이 바뀌면 목록과 AI 별 묶인 계정 표시가 함께 낡으니 계정 키 전부를 무효화한다.
 * 키·주소를 바꿨으면 그 계정으로 받은 모델 목록도 낡는다 — 어느 AI 가 이 계정을 쓰는지 여기서 모르니 모델 목록 전부를 다시 받게 한다.
 */
export function useUpdateAgentAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: AgentAccountUpdateRequest }) => updateAgentAccount(id, body),
    onSuccess: (_data, { body }) => {
      const secretChanged = body.token != null || body.providerConfig != null || body.loginInfo != null;
      if (secretChanged) void qc.invalidateQueries({ queryKey: providerModelsKeys.all });
      return qc.invalidateQueries({ queryKey: agentAccountKeys.all });
    },
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

/**
 * 이 AI 를 계정에 묶는다 — 목록(쓰는 AI 칸)은 다시 받고, 이 AI 의 묶인 계정은 응답(묶인 계정)으로 바로 채운다(한 번 더 받지 않게).
 * 묶으면 서버가 작업 공간을 다시 시작하므로 이 AI 의 실행 상태(상태 섹션·목록 요약)도 다시 받는다.
 */
export function useBindAgentAccount(userId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) => bindAgentAccount(userId as number, accountId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: agentAccountKeys.list() });
      qc.setQueryData(agentAccountKeys.forAgent(userId), data);
      if (userId != null) void qc.invalidateQueries({ queryKey: agentRuntimeKeys.setting(userId) });
      void qc.invalidateQueries({ queryKey: agentRuntimeKeys.summaries });
    },
  });
}

/**
 * Gen:iA 브라우저 로그인 진행 키(WP-1461) — 계정 키(agentAccounts)와 접두어를 나눈다.
 * 성공 때 계정 키 전부를 무효화하는데, 같은 접두어면 끝난 진행까지 한 번 더 묻게 된다.
 */
export const geniaLoginKeys = {
  detail: (id: string | null) => ['geniaLogin', id] as const,
};

/** Gen:iA 브라우저 로그인 시작 — 받은 진행을 상태 캐시에 바로 넣어, 첫 상태 조회를 기다리지 않고 대기 화면을 그린다. */
export function useStartGeniaLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: GeniaLoginStartRequest) => startGeniaLogin(req),
    onSuccess: (data) => qc.setQueryData(geniaLoginKeys.detail(data.id), data),
  });
}

/**
 * Gen:iA 브라우저 로그인 진행 상태 — 대기(PENDING) 동안만 2초마다 다시 묻는다(이 조회가 API 의 Gen:iA 폴링을 일으킨다).
 * 404(없음·지워짐 — 만료 뒤 쓸림·API 재시작)는 만료(EXPIRED) 응답으로 바꿔 돌려준다 — 화면은 만료로 보이고 폴링도 멈춘다.
 * 창이 닫히면 바로 버린다(gcTime 0 — 다시 열 때 끝난 진행을 보이지 않게). 성공 뒤 계정 목록 무효화는 호출 측(계정 창)이 한다.
 */
export function useGeniaLogin(id: string | null) {
  return useQuery<GeniaLoginResponse>({
    queryKey: geniaLoginKeys.detail(id),
    enabled: id != null,
    queryFn: async () => {
      try {
        return await getGeniaLogin(id as string);
      } catch (e) {
        if (!isNotFoundError(e)) throw e;
        return {
          id: id as string,
          status: 'EXPIRED',
          authorizeUrl: null,
          expiresAt: '',
          accountId: null,
          accountEmail: null,
          errorMessage: null,
        };
      }
    },
    // 그 밖의 조회 실패(잠깐 끊김)는 TanStack Query 가 마지막 성공 값(PENDING)을 남기므로 계속 묻는다 — 화면이 대기 그대로 굳지 않게.
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? GENIA_LOGIN_POLL_MS : false),
    // 시작 응답으로 채운 캐시를 마운트하자마자 다시 묻지 않게 — 다음 조회는 간격을 따른다.
    staleTime: GENIA_LOGIN_POLL_MS,
    retry: false,
    gcTime: 0,
  });
}
