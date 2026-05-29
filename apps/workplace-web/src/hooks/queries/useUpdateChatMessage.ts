// 메시지 수정 mutation. 성공 시 첫 페이지(또는 해당 페이지) 의 메시지를 직접 replace.
// 실패 시 toast — 캐시는 그대로 둔다 (사용자가 다시 시도 가능).

import { type InfiniteData,useMutation, useQueryClient } from '@tanstack/react-query';

import { chatApi } from '../../api/chat';
import { handleApiError } from '../../lib/api-error';
import type { ChatMessagePage, UpdateChatMessageRequest } from '../../types/chat';
import { chatKeys } from './chatKeys';

export function useUpdateChatMessage(threadId: number) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ messageId, payload }: { messageId: number; payload: UpdateChatMessageRequest }) =>
      chatApi.updateMessage(messageId, payload).then((r) => r.data),

    onSuccess: (saved) => {
      const key = chatKeys.messages(threadId);
      qc.setQueryData<InfiniteData<ChatMessagePage>>(key, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items.map((m) => (m.id === saved.id ? saved : m)),
          })),
        };
      });
    },

    onError: (err) => {
      handleApiError(err, '메시지 수정에 실패했어요');
    },
  });
}
