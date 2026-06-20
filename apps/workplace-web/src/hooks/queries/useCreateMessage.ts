// 메시지 작성 mutation + optimistic UI. 임시 id 는 음수. onSuccess 시 서버 id 로 치환 + id dedup
// (SSE self-echo 가 같은 id 를 먼저 넣었을 수 있음). onError 시 snapshot 복원 + toast.
import { type InfiniteData, useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import type {
  CreateMessageRequest,
  MessagePage,
  MessageResponse,
  UserKind,
} from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

interface MeContext {
  id: number;
  name: string;
  kind: UserKind;
}

export function useCreateMessage(channelId: number, me: MeContext) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateMessageRequest) =>
      messagingApi.createMessage(channelId, payload).then((r) => r.data),

    onMutate: async (payload) => {
      const key = messagingKeys.messages(channelId);
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<InfiniteData<MessagePage>>(key);

      const tempId = -Math.floor(Math.random() * 1_000_000_000);
      const optimistic: MessageResponse = {
        id: tempId,
        channelId,
        authorId: me.id,
        authorName: me.name,
        authorKind: me.kind,
        body: payload.body,
        mentions: [], // optimistic — 서버 응답 시 실제값으로 치환
        parentMessageId: null, // 메인 컴포저는 최상위 메시지만 작성
        replyCount: 0,
        unreadReplyCount: 0, // optimistic 메시지는 본인 작성이므로 미읽음 없음
        followed: false, // 팔로우 여부는 서버 응답에서 결정
        reactions: [],
        attachments: [], // optimistic — 서버 응답 시 실제값으로 치환
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false,
      };

      qc.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
        if (!old) {
          return {
            pages: [{ items: [optimistic], nextCursor: null, hasMore: false }],
            pageParams: [undefined],
          };
        }
        const [first, ...rest] = old.pages;
        return { ...old, pages: [{ ...first, items: [optimistic, ...first.items] }, ...rest] };
      });

      return { snapshot, tempId };
    },

    onSuccess: (saved, _payload, ctx) => {
      const key = messagingKeys.messages(channelId);
      qc.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
        if (!old) return old;
        const seen = new Set<number>();
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items
              .map((m) => (m.id === ctx?.tempId ? saved : m))
              .filter((m) => {
                if (seen.has(m.id)) return false;
                seen.add(m.id);
                return true;
              }),
          })),
        };
      });
    },

    onError: (err, _payload, ctx) => {
      const key = messagingKeys.messages(channelId);
      if (ctx?.snapshot) qc.setQueryData(key, ctx.snapshot);
      handleApiError(err, '메시지 전송에 실패했습니다');
    },
  });
}
