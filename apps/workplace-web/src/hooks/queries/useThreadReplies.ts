// 스레드 답글 infinite query. 부모 메시지별 별도 캐시(messagingKeys.thread).
import { useInfiniteQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { MessagePage } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useThreadReplies(parentMessageId: number | null) {
  return useInfiniteQuery({
    queryKey: parentMessageId ? messagingKeys.thread(parentMessageId) : messagingKeys.threads(),
    enabled: parentMessageId != null,
    queryFn: ({ pageParam }) =>
      messagingApi
        .getReplies(parentMessageId as number, pageParam as string | undefined)
        .then((r) => r.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: MessagePage) => last.nextCursor ?? undefined,
  });
}
