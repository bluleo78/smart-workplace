// 내 채널 목록(사이드바) — 멤버이고 비아카이브인 채널만.
import { useQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { ChannelResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useMyChannels(options?: { enabled?: boolean }) {
  return useQuery<ChannelResponse[]>({
    queryKey: messagingKeys.channels(),
    queryFn: () => messagingApi.listChannels().then((r) => r.data),
    staleTime: 10_000,
    enabled: options?.enabled ?? true,
  });
}
