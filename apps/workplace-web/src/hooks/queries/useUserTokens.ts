// 내 API 토큰(PAT) 목록 + 발급/폐기 mutation. 발급 응답은 plaintextToken 이 1회만 포함.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { issueMyToken, listMyTokens, revokeMyToken } from '../../api/userTokens';
import { handleApiError } from '../../lib/api-error';

export const userTokenKeys = {
  mine: ['userTokens', 'me'] as const,
};

export function useMyTokens() {
  return useQuery({
    queryKey: userTokenKeys.mine,
    queryFn: listMyTokens,
  });
}

export function useIssueMyToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string }) => issueMyToken(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userTokenKeys.mine });
      toast.success('토큰을 발급했습니다');
    },
    onError: (e) => handleApiError(e, '토큰 발급에 실패했습니다'),
  });
}

export function useRevokeMyToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: number) => revokeMyToken(tokenId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userTokenKeys.mine });
      toast.success('토큰을 폐기했습니다');
    },
    onError: (e) => handleApiError(e, '토큰 폐기에 실패했습니다'),
  });
}
