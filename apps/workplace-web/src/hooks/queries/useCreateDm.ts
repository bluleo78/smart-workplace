// DM find-or-create. 성공 시 DM 목록 무효화 — 호출처가 응답 id 로 라우팅.
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import type { DmResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useCreateDm() {
  const qc = useQueryClient();
  return useMutation<DmResponse, unknown, number[]>({
    mutationFn: (userIds) => messagingApi.createDm(userIds).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.dms() }),
    onError: (err) => handleApiError(err, 'DM 을 만들 수 없어요'),
  });
}
