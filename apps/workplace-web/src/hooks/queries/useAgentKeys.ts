// 특정 AGENT 의 API 키 목록 + 발급/회수 mutation. 발급 응답은 plaintextKey 가 1회만 포함.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { issueAgentKey, listAgentKeys, revokeAgentKey } from '../../api/agents';
import { handleApiError } from '../../lib/api-error';

export const agentKeyKeys = {
  forUser: (userId: number | null) => ['agentKeys', userId] as const,
};

export function useAgentKeys(userId: number | null) {
  return useQuery({
    queryKey: agentKeyKeys.forUser(userId),
    queryFn: () => listAgentKeys(userId as number),
    enabled: userId != null,
  });
}

export function useIssueAgentKey(userId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { label?: string | null }) => issueAgentKey(userId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeyKeys.forUser(userId) });
      toast.success('키를 발급했습니다');
    },
    onError: (e) => handleApiError(e, '키 발급에 실패했습니다'),
  });
}

export function useRevokeAgentKey(userId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keyId: number) => revokeAgentKey(userId, keyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeyKeys.forUser(userId) });
      toast.success('키를 회수했습니다');
    },
    onError: (e) => handleApiError(e, '키 회수에 실패했습니다'),
  });
}
