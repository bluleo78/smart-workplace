// 채널 메시지 cursor 페이징. 실시간 갱신은 useMessageStream 이 캐시 직접 갱신.
import { useInfiniteQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { MessagePage } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useChannelMessages(channelId: number | undefined) {
  return useInfiniteQuery<MessagePage>({
    queryKey: channelId ? messagingKeys.messages(channelId) : ['messaging', 'messages', 'idle'],
    enabled: !!channelId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      messagingApi.getMessages(channelId!, pageParam as string | undefined).then((r) => r.data),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
}
