// messaging 메시지 수정 mutation. 성공 시 messages 캐시의 해당 메시지를 서버 응답으로 replace.
// 실패 시 toast — 캐시는 그대로 둔다(재시도 가능). chat 의 useUpdateChatMessage 패턴 미러.

import { type InfiniteData, useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import type { MessagePage } from '../../types/messaging';
import { withLatestLinkPreviews } from './linkPreviewCache';
import { messagingKeys } from './messagingKeys';

export function useUpdateMessage(channelId: number) {
  const qc = useQueryClient();

  return useMutation({
    // messagingApi.updateMessage 는 이미 .data(MessageResponse) 를 반환한다.
    mutationFn: ({ messageId, body }: { messageId: number; body: string }) =>
      messagingApi.updateMessage(messageId, body),

    onSuccess: (saved) => {
      // PATCH 응답의 linkPreviews 는 다시 가져오기 전 값이다(WP-874) — 미리보기는 SSE 가 진실원이라 캐시 값을 남긴다.
      const next = withLatestLinkPreviews(qc, channelId, saved);
      // 수정된 메시지를 채널 캐시와 스레드 캐시 모두에 반영(답글은 thread 캐시에만 존재).
      const apply = (old?: InfiniteData<MessagePage>) =>
        !old
          ? old
          : {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                items: p.items.map((m) => (m.id === saved.id ? next : m)),
              })),
            };
      qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(channelId), apply);
      qc.setQueriesData<InfiniteData<MessagePage>>({ queryKey: messagingKeys.threads() }, apply);
    },

    onError: (err) => {
      handleApiError(err, '메시지 수정에 실패했습니다');
    },
  });
}
