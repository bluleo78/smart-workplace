// #65 2단계: 크로스채널 스레드 인박스 infinite query(활동순, keyset 커서).
import { useInfiniteQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { ThreadInboxPage } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useThreadsInbox() {
  return useInfiniteQuery({
    queryKey: messagingKeys.threadsInbox(),
    queryFn: ({ pageParam }) =>
      messagingApi.threadsInbox(pageParam as string | undefined).then((r) => r.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ThreadInboxPage) => last.nextCursor ?? undefined,
  });
}
