// 리액션 토글. 현재 reacted 상태로 add/remove 결정. 낙관적: 채널·모든 스레드 캐시에서
// 해당 messageId 의 reactions 를 patch. 실패 시 invalidate 로 서버 재동기화.
import {
  type InfiniteData,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import { applyReaction } from '../../lib/reactions';
import type { MessagePage, MessageResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useToggleReaction(channelId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, emoji }: { message: MessageResponse; emoji: string }) => {
      const reacted = message.reactions.find((r) => r.emoji === emoji)?.reacted ?? false;
      return reacted
        ? messagingApi.removeReaction(message.id, emoji)
        : messagingApi.addReaction(message.id, emoji);
    },

    onMutate: async ({ message, emoji }) => {
      const reacted = message.reactions.find((r) => r.emoji === emoji)?.reacted ?? false;
      const delta = reacted ? -1 : (1 as 1 | -1);
      patchReactionEverywhere(qc, channelId, message.id, (rs) =>
        applyReaction(rs, emoji, delta, true),
      );
    },

    onError: (err) => {
      // 정합 복구는 서버 재조회로(간단). 채널·스레드 캐시 무효화.
      qc.invalidateQueries({ queryKey: messagingKeys.messages(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.threads() });
      handleApiError(err, '리액션 처리에 실패했어요');
    },
  });
}

/** 채널 메시지 캐시 + 모든 스레드 캐시에서 messageId 의 reactions 를 변환 적용. */
export function patchReactionEverywhere(
  qc: ReturnType<typeof useQueryClient>,
  channelId: number,
  messageId: number,
  transform: (rs: MessageResponse['reactions']) => MessageResponse['reactions'],
) {
  const apply = (old?: InfiniteData<MessagePage>) =>
    !old
      ? old
      : {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items.map((m) =>
              m.id === messageId ? { ...m, reactions: transform(m.reactions) } : m,
            ),
          })),
        };
  qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(channelId), apply);
  qc.setQueriesData<InfiniteData<MessagePage>>({ queryKey: messagingKeys.threads() }, apply);
}
