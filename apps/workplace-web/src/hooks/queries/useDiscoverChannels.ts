// 공개 채널 탐색 — q ILIKE 검색. 모달 열림 동안에만 호출되도록 enabled 제어.
import { useQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { ChannelResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useDiscoverChannels(q: string, enabled = true) {
  return useQuery<ChannelResponse[]>({
    queryKey: messagingKeys.discover(q),
    queryFn: () => messagingApi.discoverChannels(q || undefined).then((r) => r.data),
    enabled,
    staleTime: 5_000,
  });
}
