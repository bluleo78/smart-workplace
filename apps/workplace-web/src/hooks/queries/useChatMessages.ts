// chat 메시지 cursor 페이징.
// 실시간 갱신은 SSE(useChatStream)가 담당 → 폴링 제거. 재연결 catch-up 은 staleTime 만료 후 refetch.
// initialData 는 ChatThread 응답의 recentMessages 로 호출처에서 seeded.

import { useInfiniteQuery } from '@tanstack/react-query';

import { chatApi } from '../../api/chat';
import type { ChatMessagePage } from '../../types/chat';
import { chatKeys } from './chatKeys';

interface UseChatMessagesOptions {
  threadId: number | undefined;
  // 초기 시드. 첫 페이지를 thread 응답의 recentMessages 로 채울 때 사용.
  initialFirstPage?: ChatMessagePage;
}

export function useChatMessages({ threadId, initialFirstPage }: UseChatMessagesOptions) {
  return useInfiniteQuery<ChatMessagePage>({
    queryKey: threadId ? chatKeys.messages(threadId) : ['chat', 'messages', 'idle'],
    enabled: !!threadId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      chatApi.getMessages(threadId!, pageParam as string | undefined).then((r) => r.data),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // 시드 직후 5초 동안은 stale 로 보지 않아 즉시 refetch 가 일어나지 않는다.
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    initialData: initialFirstPage
      ? { pages: [initialFirstPage], pageParams: [undefined] }
      : undefined,
  });
}
