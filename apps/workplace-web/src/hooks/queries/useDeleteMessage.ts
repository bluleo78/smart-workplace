// messaging 메시지 soft-delete mutation. 성공 시 캐시의 해당 메시지 deleted=true, body='(삭제됨)' 처리.
// chat 의 useDeleteChatMessage 패턴 미러.

import { type InfiniteData, useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import type { MessagePage } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useDeleteMessage(channelId: number) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (messageId: number) => messagingApi.deleteMessage(messageId).then(() => messageId),

    onSuccess: (messageId) => {
      const key = messagingKeys.messages(channelId);
      qc.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
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
      handleApiError(err, '메시지 삭제에 실패했어요');
    },
  });
}
