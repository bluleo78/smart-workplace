// 내 DM 목록(사이드바 DM 섹션). 채널과 동일하게 10s staleTime.
import { useQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { DmResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useMyDms() {
  return useQuery<DmResponse[]>({
    queryKey: messagingKeys.dms(),
    queryFn: () => messagingApi.listDms().then((r) => r.data),
    staleTime: 10_000,
  });
}
