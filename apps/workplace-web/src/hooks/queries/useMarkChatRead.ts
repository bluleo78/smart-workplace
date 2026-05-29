// 읽음 표시 mutation. 호출처에서 useDebounceValue + IntersectionObserver 로 발화 제어.
// 응답 무시, 실패 시 silent — 다음 intersection 에서 재시도.

import { useMutation } from '@tanstack/react-query';

import { chatApi } from '../../api/chat';
import type { MarkChatReadRequest } from '../../types/chat';

export function useMarkChatRead(threadId: number) {
  return useMutation({
    mutationFn: (payload: MarkChatReadRequest) =>
      chatApi.markRead(threadId, payload).then(() => undefined),
  });
}
