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
      // 삭제 표시를 채널 캐시와 스레드 캐시 모두에 반영(답글은 thread 캐시에만 존재).
      const apply = (old?: InfiniteData<MessagePage>) =>
        !old
          ? old
          : {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                items: p.items.map((m) =>
                  m.id === messageId ? { ...m, deleted: true, body: '(삭제됨)' } : m,
                ),
              })),
            };
      qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(channelId), apply);
      qc.setQueriesData<InfiniteData<MessagePage>>({ queryKey: messagingKeys.threads() }, apply);
    },

    onError: (err) => {
      handleApiError(err, '메시지 삭제에 실패했어요');
    },
  });
}
