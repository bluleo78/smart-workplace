// 메시지 soft-delete mutation. 성공 시 캐시의 해당 메시지 deleted=true, body='(삭제됨)' 처리.

import { type InfiniteData,useMutation, useQueryClient } from '@tanstack/react-query';

import { chatApi } from '../../api/chat';
import { handleApiError } from '../../lib/api-error';
import type { ChatMessagePage } from '../../types/chat';
import { chatKeys } from './chatKeys';

export function useDeleteChatMessage(threadId: number) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (messageId: number) => chatApi.deleteMessage(messageId).then(() => messageId),

    onSuccess: (messageId) => {
      const key = chatKeys.messages(threadId);
      qc.setQueryData<InfiniteData<ChatMessagePage>>(key, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items.map((m) =>
              m.id === messageId ? { ...m, deleted: true, body: '(삭제됨)' } : m,
            ),
          })),
        };
      });
    },

    onError: (err) => {
      handleApiError(err, '메시지 삭제에 실패했습니다');
    },
  });
}
