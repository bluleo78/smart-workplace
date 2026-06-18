// AGENT 유저 목록 + 생성/삭제 mutation. queryKey 는 ['agents'] 단일.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { createAgent, deleteAgent, listAgents } from '../../api/agents';
import { handleApiError } from '../../lib/api-error';

export const agentKeys = {
  all: ['agents'] as const,
};

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.all,
    queryFn: listAgents,
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
