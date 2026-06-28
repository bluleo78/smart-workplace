// AGENT 유저 목록 + 생성/삭제 mutation. queryKey 는 ['agents'] 단일.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { createAgent, deleteAgent, listAgents, renameAgent } from '../../api/agents';
import { handleApiError } from '../../lib/api-error';

export const agentKeys = {
  all: ['agents'] as const,
  list: (includePersonal: boolean) => ['agents', { includePersonal }] as const,
};

// includePersonal=true 면 개인 비서(자동 생성 AGENT)까지 포함해 조회한다.
export function useAgents(includePersonal = false) {
  return useQuery({
    queryKey: agentKeys.list(includePersonal),
    queryFn: () => listAgents(includePersonal),
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createAgent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
      toast.success('에이전트를 추가했습니다');
    },
    onError: (e) => handleApiError(e, '에이전트 추가에 실패했습니다'),
  });
}

// AGENT 이름/식별자 변경. 성공 시 목록 갱신 + 토스트.
export function useRenameAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      username,
      name,
    }: {
      userId: number;
      username: string;
      name: string;
    }) => renameAgent(userId, { username, name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
      toast.success('에이전트를 변경했습니다');
    },
    onError: (e) => handleApiError(e, '에이전트 변경에 실패했습니다'),
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteAgent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
      toast.success('에이전트를 삭제했습니다');
    },
    onError: (e) => handleApiError(e, '에이전트 삭제에 실패했습니다'),
  });
}
