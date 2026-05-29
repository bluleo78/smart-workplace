// chat 메시지 cursor 페이징 + 5초 visible 폴링.
// 폴링은 visible 조건이 모두 충족될 때만 enabled.
// initialData 는 ChatThread 응답의 recentMessages 로 호출처에서 seeded.

import { useInfiniteQuery } from '@tanstack/react-query';
import { chatApi } from '../../api/chat';
import type { ChatMessagePage } from '../../types/chat';
import { chatKeys } from './chatKeys';

interface UseChatMessagesOptions {
  threadId: number | undefined;
  // section in viewport AND document.visible 일 때 true.
  pollingEnabled: boolean;
  // 초기 시드. 첫 페이지를 thread 응답의 recentMessages 로 채울 때 사용.
  initialFirstPage?: ChatMessagePage;
}

export function useChatMessages({
  threadId,
  pollingEnabled,
  initialFirstPage,
}: UseChatMessagesOptions) {
  return useInfiniteQuery<ChatMessagePage>({
    queryKey: threadId ? chatKeys.messages(threadId) : ['chat', 'messages', 'idle'],
    enabled: !!threadId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      chatApi.getMessages(threadId!, pageParam as string | undefined).then((r) => r.data),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // 폴링 cadence 와 맞춰, 시드 직후 5초 동안은 stale 로 보지 않아 즉시 refetch 가 일어나지 않는다.
    staleTime: 5_000,
    refetchInterval: pollingEnabled ? 5_000 : false,
    // 폴링이 visibility 조건과 묶여 있으므로, 백그라운드/포커스 복귀 refetch 는 중복이 되어 끈다.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    initialData: initialFirstPage
      ? { pages: [initialFirstPage], pageParams: [undefined] }
      : undefined,
  });
}
