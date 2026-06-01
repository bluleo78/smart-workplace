// 공개 채널 목록.
import { useQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { ChannelResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useChannels() {
  return useQuery<ChannelResponse[]>({
    queryKey: messagingKeys.channels(),
    queryFn: () => messagingApi.listChannels().then((r) => r.data),
    staleTime: 10_000,
  });
}
